#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""check_pdf.py — 研报 PDF 的准出体检（契约见 docs/report-pipeline.md §7/§8）。

    python check_pdf.py --pdf report.pdf [--json] [--render-pages 3 --render-dir <dir>]

输出（--json 时只输出这份 JSON）：

    {"ok":true,"pages":16,"bytes":1234567,"images":7,"text_chars":48210,
     "has_cover_text":true,"render":{"pages":[".../p-1.png", ...]},
     "page_numbers":[2,3,...],"text_source":"pdftotext","warnings":[]}

设计要点：
* 只依赖标准库；``pdfinfo``/``pdftoppm``/``pdftotext`` 找不到时**降级而不报错**
  （页数退回扫 ``/Type /Pages`` 的 ``/Count``，再退回 ``/Type /Page`` 计数；
   文字退回解压内容流后数文本算子的近似值）。
* ``images`` 用 ``/Subtype /Image`` 计数，是**近似值**（同一张图被复用可能只算一次），
  契约 §6 明确允许这个误差。
* ``has_cover_text``：默认「第 1 页有文字」；给了 ``--expect`` 时改为「第 1 页包含全部
  指定文字」，用来真正校验封面有没有公司名/报告日（契约 §8.5）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import zlib

__version__ = "1.0.0"

TOOL_CACHE = {}


# =====================================================================================
# 外部工具探测（PATH → TeX Live → poppler 常见目录）
# =====================================================================================
def tool_path(name):
    if name in TOOL_CACHE:
        return TOOL_CACHE[name]
    hit = shutil.which(name)
    if not hit:
        for root in (r"D:\texlive", r"C:\Program Files\poppler", r"C:\poppler"):
            if hit or not os.path.isdir(root):
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                if os.path.basename(dirpath).lower() in ("windows", "bin") and \
                        (name + ".exe") in filenames:
                    hit = os.path.join(dirpath, name + ".exe")
                    break
                # 只在浅层找，避免在大磁盘上无谓遍历
                if dirpath.count(os.sep) - root.count(os.sep) > 2:
                    dirnames[:] = []
    TOOL_CACHE[name] = hit
    return hit


def _run(cmd, timeout=120):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout)


# =====================================================================================
# 页数 / 图片 / 文字
# =====================================================================================
def pdf_pages(path):
    """返回 (页数, 统计方式)。"""
    exe = tool_path("pdfinfo")
    if exe:
        try:
            proc = _run([exe, path])
            m = re.search(rb"Pages:\s+(\d+)", proc.stdout)
            if m:
                return int(m.group(1)), "pdfinfo"
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return 0, "unreadable"
    counts = re.findall(rb"/Type\s*/Pages[^>]*?/Count\s+(\d+)", data)
    if counts:
        return max(int(c) for c in counts), "scan:/Count"
    return len(re.findall(rb"/Type\s*/Page[^s]", data)), "scan:/Type /Page"


def pdf_images(path):
    """/Subtype /Image 计数（近似值）。

    带透明通道的插图会被 LibreOffice 拆成「图像 + smask」两个图像对象，
    所以再减掉 `/SMask N 0 R` 的引用数，得到的才是「插图张数」。
    """
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return 0
    total = len(re.findall(rb"/Subtype\s*/Image", data))
    masks = len(re.findall(rb"/SMask\s+\d+\s+\d+\s+R", data))
    return max(0, total - masks)


def _text_from_streams(path):
    """无 pdftotext 时的兜底：解压 FlateDecode 内容流，数 Tj/TJ 里的字符数。

    注意：CJK 在 PDF 里通常是 CID 字形编号，解码出来多是乱码，只能当作
    「正文是否非空」的粗略信号，所以 text_source 会标成 stream-scan。
    """
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return []
    chunks = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", data, flags=re.S):
        raw = m.group(1)
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            continue
        chunks.append(raw)
    text = []
    for blob in chunks:
        for m in re.finditer(rb"\((?:\\.|[^\\()])*\)", blob):
            frag = m.group(0)[1:-1]
            if frag:
                text.append(frag.decode("latin-1", "replace"))
    return ["\f".join(text)]


def extract_pages(path):
    """返回 (页文本列表, 文字来源)。"""
    exe = tool_path("pdftotext")
    if exe:
        try:
            proc = _run([exe, "-enc", "UTF-8", "-layout", path, "-"])
            if proc.returncode == 0 and proc.stdout:
                text = proc.stdout.decode("utf-8", "replace")
                pages = text.split("\f")
                if pages and not pages[-1].strip():
                    pages.pop()
                return pages, "pdftotext"
        except (OSError, subprocess.SubprocessError):
            pass
    joined = _text_from_streams(path)
    return joined[0].split("\f") if joined else [], "stream-scan"


# 行尾 1-3 位数字即页码候选：前面若紧邻数字/小数点（20.9、2026）就否掉，
# 避免把正文里的年份、数值当成页码。
_TAIL_NUM_RE = re.compile(r"(?<![0-9.])([0-9]{1,3})\s*$")
# 行尾数字前面紧跟这些符号时，说明它属于一个更大的数值（4.1%、20.9、1/2）
_NUM_PREFIX_BAD = set(".,%‰／/:：±+~-－—")


def _tail_page_number(line, pages_total):
    """从一行里抠出行尾的页码数字；不像页码就返回 None。"""
    text = line.rstrip()
    m = _TAIL_NUM_RE.search(text)
    if not m:
        return None
    if m.start() > 0 and text[m.start() - 1] in _NUM_PREFIX_BAD:
        return None
    val = int(m.group(1))
    if val < 1 or val > pages_total + 1:      # 页码不可能超过总页数太多
        return None
    if len(text) - m.end() > 0:
        return None
    return val


def page_footer_numbers(pages):
    """从每页最后几行里挑出页码，用来验证「页脚有页码、且全文连续」。

    pdftotext -layout 常把页脚和正文并成一行（「澜沧水电（601234.SH）· 深度研究      2」），
    所以不能只认「整行就是一个数字」的孤立行：逐行取行尾数字，再兜底扫页尾 120 字符。
    """
    total = len(pages)
    found = []
    for text in pages:
        lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
        hit = None
        for ln in reversed(lines[-3:]):
            hit = _tail_page_number(ln, total)
            if hit is not None:
                break
        if hit is None and text.strip():
            tail = text.strip()[-120:]
            hit = _tail_page_number(tail.rsplit("\n", 1)[-1], total)
        found.append(hit)
    return found


# =====================================================================================
# 渲染
# =====================================================================================
def render_pages(path, out_dir, count=3, dpi=110):
    """用 pdftoppm 渲染前 count 页；工具缺失则安静跳过。"""
    exe = tool_path("pdftoppm")
    if not exe:
        return [], "pdftoppm 不可用，已跳过渲染"
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0])
    cmd = [exe, "-png", "-r", str(dpi), "-f", "1", "-l", str(max(1, count)), path, stem]
    try:
        proc = _run(cmd)
    except (OSError, subprocess.SubprocessError) as exc:
        return [], "pdftoppm 渲染失败：%s" % exc
    if proc.returncode != 0:
        return [], "pdftoppm 渲染失败：%s" % proc.stderr.decode("utf-8", "replace")[:300]
    made = sorted(p for p in os.listdir(out_dir)
                  if p.startswith(os.path.basename(stem) + "-") and p.lower().endswith(".png"))
    return [os.path.join(out_dir, p) for p in made], ""


# =====================================================================================
# CLI
# =====================================================================================
def build_parser():
    ap = argparse.ArgumentParser(
        prog="check_pdf.py",
        description="研报 PDF 准出体检：页数/字节/内嵌图片/文字量/页码/页面渲染")
    ap.add_argument("--pdf", required=True, help="待检查的 PDF")
    ap.add_argument("--json", action="store_true", help="stdout 只输出一行 JSON")
    ap.add_argument("--render-pages", type=int, default=0, metavar="N",
                    help="渲染前 N 页 PNG（0 = 不渲染）")
    ap.add_argument("--render-dir", help="PNG 输出目录，默认与 PDF 同级的 render/")
    ap.add_argument("--render-dpi", type=int, default=110, help="渲染 DPI，默认 110")
    ap.add_argument("--expect", nargs="*", default=None, metavar="文字",
                    help="封面页必须出现的文字（可多段），用于校验公司名/报告日")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    pdf = os.path.abspath(args.pdf)
    warnings = []
    payload = {"ok": False, "pages": 0, "bytes": 0, "images": 0, "text_chars": 0,
               "has_cover_text": False, "render": {"pages": []}, "page_numbers": [],
               "text_source": "", "warnings": warnings}

    if not os.path.isfile(pdf):
        warnings.append("PDF 不存在：%s" % pdf)
        _emit(payload, args.json, ["FAIL 文件不存在：%s" % pdf])
        return 1

    size = os.path.getsize(pdf)
    with open(pdf, "rb") as fh:
        head = fh.read(8)
    if not head.startswith(b"%PDF-"):
        warnings.append("文件头不是 %%PDF-：%r" % head)
    pages, how = pdf_pages(pdf)
    images = pdf_images(pdf)
    page_texts, text_source = extract_pages(pdf)
    text_chars = sum(len(t.strip()) for t in page_texts)
    if pages != len(page_texts) and text_source == "pdftotext" and len(page_texts):
        warnings.append("pdfinfo 页数(%d) 与抽到的文本页数(%d) 不一致，已按较大者计"
                        % (pages, len(page_texts)))
        pages = max(pages, len(page_texts))

    cover_text = (page_texts[0] if page_texts else "").strip()
    if args.expect:
        # pdftotext 会把 Word/LO 的「中西文自动间距」还原成空格（2026年10月18日 → 2026 年 10 月 18 日），
        # 所以比对前两边都去掉空白字符。
        cover_sq = re.sub(r"\s+", "", cover_text)
        missing = [k for k in args.expect if k and re.sub(r"\s+", "", k) not in cover_sq]
        has_cover_text = not missing and bool(cover_text)
        if missing:
            warnings.append("封面页缺少文字：%s" % "、".join(missing))
    else:
        has_cover_text = bool(cover_text)

    numbers = page_footer_numbers(page_texts) if text_source == "pdftotext" else []

    rendered, render_note = [], ""
    if args.render_pages and args.render_pages > 0:
        out = args.render_dir or os.path.join(os.path.dirname(pdf), "render")
        rendered, render_note = render_pages(pdf, os.path.abspath(out),
                                            args.render_pages, args.render_dpi)
        if render_note:
            warnings.append(render_note)

    ok = (head.startswith(b"%PDF-") and pages >= 1 and size > 1024 and text_chars > 0)
    if not ok:
        if pages < 1:
            warnings.append("页数为 0（统计方式 %s）" % how)
        if text_chars <= 0:
            warnings.append("抽不到正文文字（text_source=%s），可能全是图片" % text_source)

    payload.update({"ok": ok, "pages": pages, "bytes": size, "images": images,
                    "text_chars": text_chars, "has_cover_text": has_cover_text,
                    "render": {"pages": rendered}, "page_numbers": numbers,
                    "text_source": text_source})

    human = [
        "%s  %s" % ("OK  " if ok else "FAIL", pdf),
        "    pages=%d（%s）  bytes=%d  images=%d  text_chars=%d（%s）"
        % (pages, how, size, images, text_chars, text_source or "-"),
        "    封面页文字=%s  has_cover_text=%s" % (len(cover_text), has_cover_text),
    ]
    detected = [n for n in numbers if n]
    if numbers:
        if not detected:
            human.append("    页脚页码=未检出（pdftotext 未在页尾找到数字）")
            warnings.append("未能从页尾识别出页码，请人工确认页脚是否有 PAGE 域")
        else:
            human.append("    页脚页码=%d/%d 页检出：%s"
                         % (len(detected), len(numbers),
                            ", ".join(str(n) if n else "—" for n in numbers)))
            # 从首次检出页码的那一页起，页码应当逐页 +1（封面通常不带页码）
            first = next(i for i, n in enumerate(numbers) if n)
            seq = numbers[first:]
            based = seq[0]
            expect = list(range(based, based + len(seq)))
            if seq == expect:
                human.append("    页码连续：%d … %d ✓" % (expect[0], expect[-1]))
            else:
                broken = [(i + first + 1, n, e)
                          for i, (n, e) in enumerate(zip(seq, expect)) if n != e]
                detail = "、".join("第%d页=%s(应为%d)" % b for b in broken[:6])
                warnings.append("页码不连续：%s" % detail)
                human.append("    页码不连续：%s" % detail)
    for png in rendered:
        human.append("    png %s" % png)
    for w in warnings:
        human.append("    warn: %s" % w)
    _emit(payload, args.json, human)
    return 0 if ok else 1


def _emit(payload, as_json, lines):
    if as_json:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        return
    for line in lines:
        sys.stdout.write(line + "\n")


if __name__ == "__main__":
    sys.exit(main())
