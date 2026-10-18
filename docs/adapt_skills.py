#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""adapt_skills.py — 把 ai-berkshire 的 21 个 Claude Code skill 机械改造成
DeepSeek Harness (DSH) 原生技能，并抓取 tools/。

源仓库 : https://github.com/xbtlin/ai-berkshire (main)
源文件 : skills/<slug>.md  × 21      tools/<file> × 13
产出   : <pkg>/skills/<slug>/SKILL.md × 21
         <pkg>/tools/<file>            （原样拷贝，字节完全一致）
         <pkg>/docs/ADAPTATION.md      （改造说明，本脚本生成）

用法:
    python packages\\dsh-invest-bundle\\docs\\adapt_skills.py           # 正常改造
    python packages\\dsh-invest-bundle\\docs\\adapt_skills.py --refresh # 忽略本地缓存重新下载

设计原则:
  * 只做 7 类机械替换 + 5 项可移植性修补，不新增、不删除任何方法论内容；
  * 不压缩正文：原文多少字，改造后仍是那些字（除了替换项本身）；
  * 每个替换项都计数，写入 docs/ADAPTATION.md，便于逐条复核。

注意: 源文件缓存在 %TEMP%\\berkshire-raw-cache，重复运行不会重复下载。
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = "xbtlin/ai-berkshire"
BRANCH = "main"
RAW = "https://raw.githubusercontent.com/%s/%s/" % (REPO, BRANCH)
API_COMMIT = "https://api.github.com/repos/%s/commits/%s" % (REPO, BRANCH)
CACHE = os.path.join(
    os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp",
    "berkshire-raw-cache",
)
PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../packages/dsh-invest-bundle

SLUGS = [
    "bottleneck-hunter", "deep-company-series", "dyp-ask", "earnings-review",
    "earnings-team", "era-alpha", "financial-data", "income-investment",
    "industry-funnel", "industry-research", "investment-checklist",
    "investment-research", "investment-team", "management-deep-dive",
    "news-pulse", "portfolio-review", "private-company-research",
    "quality-screen", "thesis-drift", "thesis-tracker", "wechat-article",
]

# tools/ 目录清单（已核实）；star-test 不存在，xkcd.woff 字体文件跳过
TOOLS = [
    "ashare_data.py", "financial_rigor.py", "log-command.sh",
    "momentum_backtest.py", "momentum_backtest_v2.py",
    "morningstar_fair_value.py", "report_audit.py", "reports_index.py",
    "star_history_chart.py", "stock_screener.py", "terminal_value.py",
    "twstock_data.py", "xueqiu_scraper.py",
]
SKIPPED_TOOLS = ["xkcd.woff"]

# --- 技能目录元数据：description 取自原文 H1/定位，whenToUse 为触发词 ------
META = {
    "bottleneck-hunter": (
        "供应链瓶颈猎手：沿超级趋势做全球产业链瓶颈扫描，专找第二、三层「咽喉」环节的套利机会，产出瓶颈地图与标的候选。",
        "供应链瓶颈, 瓶颈套利, 产业链扫描, 卡脖子环节, 超级趋势, AI算力链",
    ),
    "deep-company-series": (
        "看懂XX公司深度公司系列：为一家公司撰写 3-8 篇《看懂XX》长文，全系列贯穿事实核查标准，面向公众号等公开渠道发布。",
        "看懂一家公司, 深度长文系列, 公众号长文, 公司研究写作, 系列文章, 事实核查",
    ),
    "dyp-ask": (
        "段永平问答：以段永平（大道至简/大道行思）的思维框架与语言风格回答投资、商业与人生问题。",
        "段永平, 大道至简, 本分, 企业文化, 投资问答, 段永平会怎么想",
    ),
    "earnings-review": (
        "财报精读：以一手财报原文为核心做单 Agent 深度解读，覆盖生意本质、财务质量、竞争变化与风险信号，输出精读报告。",
        "财报精读, 读财报, 季报解读, 年报解读, 一手财报, 财报电话会",
    ),
    "earnings-team": (
        "财报精读团队：四位大师并行解读财报，再由编辑润色、读者评审，产出可直接发布的公众号文章。",
        "财报团队, 多Agent财报, 财报精读团队, 财报发布, 公众号财报文章, 四大师",
    ),
    "era-alpha": (
        "时代α捕手：用「行业认知地图→自问核心问题→全方位验证→持有到拐点」四步法识别高增长行业里真正有定价权的核心资产。",
        "时代α, 高增长行业, 核心资产, α企业, 行业认知地图, 持有到拐点",
    ),
    "financial-data": (
        "财务数据获取与交叉验证规范：每个关键数据必须两源交叉、误差>1% 标记，覆盖美股/港股/A股/台股的数据源优先级与口径差异。",
        "财务数据, 数据源, 交叉验证, 市值验算, 台股数据, 数据口径",
    ),
    "income-investment": (
        "收益型投资分析：判断公司可分配收益的持久性与吸引力，评估其作为长期收益仓位或机会型收益率仓位的适配性。",
        "股息, 分红, 收益型投资, 派息可持续性, 股息率, FCF yield",
    ),
    "industry-funnel": (
        "行业漏斗筛选：从全市场扫描逐层精选到 3 家终选标的，每层都有明确的留/弃标准，可复盘可追溯。",
        "行业筛选, 漏斗筛选, 全市场扫描, 行业标的精选, 终选三家公司",
    ),
    "industry-research": (
        "行业投资研究：行业逻辑链验证 + 产业链全景扫描 + 四大师个股分析框架，输出行业级配置建议。",
        "行业研究, 产业链全景, 赛道研究, 行业投资, 行业配置, 产业链扫描",
    ),
    "investment-checklist": (
        "巴菲特价值投资买入前 Checklist：对单个或多个公司逐项过核心检查项，给出通过/不通过结论与说明。",
        "买入前检查, 巴菲特清单, checklist, 投资检查表, 买入决策",
    ),
    "investment-research": (
        "投资研究：巴菲特-芒格-段永平-李录四大师框架下的七模块综合分析，输出完整公司研究报告与分层操作建议。",
        "投资研究, 公司研究, 四大师, 护城河, 估值, 买入决策",
    ),
    "investment-team": (
        "投研团队：四角色（商业模式/财务估值/行业竞争/风险管理）并行分析，由协调者汇总成四维评分与分层操作建议。",
        "投研团队, 四角色并行, 多Agent投研, 团队研究, 四维评分",
    ),
    "management-deep-dive": (
        "管理层纵深研究：把管理层当作核心变量做纵深尽调，覆盖能力圈、诚信度、战略眼光、资本配置与治理结构。",
        "管理层研究, 管理层评估, 买股票就是买人, 治理结构, 资本配置",
    ),
    "news-pulse": (
        "公司新闻脉搏：股价异动时快速归因，4 个并行 Agent 侦察公司事件/监管政策/行业对手/市场情绪，产出事件时间线与异动主因判断。",
        "新闻归因, 股价异动, 大涨大跌, 事件侦察, 新闻脉搏, 异动归因",
    ),
    "portfolio-review": (
        "组合管理：从研究公司走向管理组合，审视持仓结构、仓位与再平衡，输出组合优化建议并落盘组合文件。",
        "组合管理, 持仓审视, 仓位, 再平衡, 投资组合优化",
    ),
    "private-company-research": (
        "未上市公司研究：多 Agent 并行深度研究框架，用拼图式研究与多源交叉还原未上市公司的真实价值。",
        "未上市公司, 一级市场, 私募公司研究, 非上市公司估值, 拼图式研究",
    ),
    "quality-screen": (
        "去劣筛选：用 7 条硬指标快速排除非一流公司，含 3 条豁免规则与分层筛选流程。",
        "去劣筛选, 快速排除, 7条指标, 公司质量筛选, 排除法",
    ),
    "thesis-drift": (
        "投资论文漂移检测：对比新旧论文快照，区分「事实变化」与「措辞变化」，判断是否需要修订投资论文。",
        "论文漂移, 投资论文对比, 事实变化, 论文重审, thesis drift",
    ),
    "thesis-tracker": (
        "投资论文追踪：买入后的纪律系统，建立结构化投资论文（核心假设/红线清单/估值锚点）并按季度追踪检查。",
        "投资论文, 买入后跟踪, 论文追踪, 假设验证, 红线清单",
    ),
    "wechat-article": (
        "微信公众号文章：作者-编辑-读者三 Agent 协作，先研究再写作再精修，产出可直接发布的公众号文章。",
        "公众号文章, 写文章, 长文写作, 三Agent协作, 文章精修",
    ),
}

# --- 第〇步插桩位置：("before"|"after", 该文件里的锚点标题前缀) -------------
ANCHORS = {
    "bottleneck-hunter": ("before", "## 第一步：超级趋势确认"),
    "deep-company-series": ("before", "## 一、触发场景"),
    "dyp-ask": ("before", "## 执行指令"),
    "earnings-review": ("after", "## 执行流程"),
    "earnings-team": ("before", "## 阶段一：四大师并行研究"),
    "era-alpha": ("before", "## 第一步：行业认知地图"),
    "financial-data": ("after", "## 执行规范"),
    "income-investment": ("after", "## Execution Workflow"),
    "industry-funnel": ("before", "## 第一步：全市场扫描入口"),
    "industry-research": ("before", "## 第一步：投资逻辑链构建与验证"),
    "investment-checklist": ("after", "## 执行流程"),
    "investment-research": ("before", "## 研究框架"),
    "investment-team": ("after", "## 执行流程"),
    "management-deep-dive": ("after", "## 执行流程"),
    "news-pulse": ("after", "## 执行流程"),
    "portfolio-review": ("after", "## 执行流程"),
    "private-company-research": ("after", "## 执行流程"),
    "quality-screen": ("after", "## 执行流程"),
    "thesis-drift": ("after", "## 执行流程"),
    "thesis-tracker": ("after", "## 执行流程"),
    "wechat-article": ("before", "## 阶段一：研究与素材收集"),
}

TARGET = "用户本轮指定的标的（从对话上下文取；缺失就先反问，不要编造）"

PREFLIGHT = """## 第〇步：联网可用性预检

**本步骤先于一切取数与分析，不可跳过。**

1. 确认本轮会话中 `web_search` 与 `web_fetch` 工具**实际可用**（不是"理论上应该能用"）：先用一次无害的检索探针验证调用能真实返回结果。
2. 若任一工具不可用、调用被拦截或无返回，**立即停止**，明确告知用户：**「本轮无联网能力，无法产出可信研报」**，并说明缺联网时只做框架讨论、不产出任何含数据的结论。
3. **禁止凭记忆编造数据**：不得用训练语料里的旧数据、估算值或"看起来合理"的数字冒充本轮检索结果。原项目 issue #58 的失败模式正是检索被静默拦截后仍输出完整研报——宁可中止，不可伪装。
4. 引用来源必须是**本轮实际抓取到的 URL**（`web_fetch` 实际返回的页面 / `web_search` 返回且已打开核实的条目），不得引用记忆中或未打开核实的链接。
5. 每份报告末尾必须有**「数据来源与抓取时间」**表，逐条列出：数据点 / 来源 URL / 抓取时间（YYYY-MM-DD HH:MM，注明时区）。

---"""


# ========================= 工具函数 =========================
def out_path(*parts):
    return os.path.join(PKG, *parts)


def fetch(url, dest, retries=4, refresh=False):
    if not refresh and os.path.exists(dest) and os.path.getsize(dest) > 0:
        return os.path.getsize(dest)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dsh-adapt/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(data)
            return len(data)
        except Exception as exc:  # noqa: BLE001 - 需要记录最后一次真实错误
            last = exc
            time.sleep(2 + 2 * attempt)
    raise RuntimeError("下载失败 %s: %r" % (url, last))


def read_text(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    return raw.replace(b"\r\n", b"\n").decode("utf-8")


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def strip_frontmatter(text, stats):
    """原文若有 Claude 风格 frontmatter（news-pulse），整块丢弃，稍后重建。"""
    if text.startswith("---\n"):
        end = text.find("\n---\n", 3)
        if end != -1:
            stats.add("frontmatter:原frontmatter移除", 1)
            return text[end + 5:].lstrip("\n")
    return text


def add_tolerance(text):
    """给所有 financial_rigor.py cross-validate 命令补 --tolerance 1.0（工具默认 2.0）。"""
    lines = text.split("\n")
    count = 0
    i = 0
    while i < len(lines):
        if "cross-validate" in lines[i] and "--tolerance" not in lines[i]:
            j = i
            while j + 1 < len(lines) and lines[j].rstrip().endswith("\\"):
                j += 1
            if "--tolerance" not in lines[j]:
                last = lines[j]
                m = re.search(r"\s+#", last)
                if m:
                    head, tail = last[:m.start()], last[m.start():]
                else:
                    head, tail = last.rstrip(), last[len(last.rstrip()):]
                head = head.rstrip()
                if head.endswith("`"):
                    head = head[:-1] + " --tolerance 1.0`"
                else:
                    head = head + " --tolerance 1.0"
                lines[j] = head + tail
                count += 1
            i = j + 1
        else:
            i += 1
    return "\n".join(lines), count


def insert_preflight(text, slug, stats):
    mode, anchor = ANCHORS[slug]
    lines = text.split("\n")
    hits = [i for i, line in enumerate(lines) if line.startswith(anchor)]
    if len(hits) != 1:
        raise RuntimeError("%s: 预检锚点 %r 命中 %d 次（应为 1）" % (slug, anchor, len(hits)))
    at = hits[0]
    block = PREFLIGHT.split("\n")
    if mode == "before":
        lines[at:at] = [""] + block + [""]
    else:
        lines[at + 1:at + 1] = [""] + block + [""]
    stats.add("preflight:第〇步联网预检", 1)
    return "\n".join(lines)


def build_frontmatter(slug, stats):
    desc, when = META[slug]
    for value in (desc, when, slug):
        if ": " in value or "\t" in value or value != value.strip():
            raise RuntimeError("%s: frontmatter 值不是安全 YAML 标量: %r" % (slug, value))
    stats.add("frontmatter:DSH frontmatter", 1)
    return "---\nname: %s\ndescription: %s\nwhenToUse: %s\n---\n\n" % (slug, desc, when)


def parse_frontmatter(text):
    """不依赖 pyyaml 的最小解析：返回 (dict, body)，解析失败抛异常。"""
    if not text.startswith("---\n"):
        raise ValueError("缺少 frontmatter 起始标记")
    end = text.find("\n---\n", 3)
    if end == -1:
        raise ValueError("frontmatter 未闭合")
    block, body = text[4:end], text[end + 5:]
    result = {}
    for line in block.split("\n"):
        if not line.strip():
            continue
        if ": " not in line:
            raise ValueError("非法 frontmatter 行: %r" % line)
        key, value = line.split(": ", 1)
        result[key.strip()] = value.strip()
    return result, body


class Stats(object):
    def __init__(self):
        self.per_file = {}
        self.current = None

    def start(self, slug):
        self.current = slug
        self.per_file[slug] = {}

    def add(self, label, n):
        if n:
            bucket = self.per_file[self.current]
            bucket[label] = bucket.get(label, 0) + n

    def total(self, slug):
        return sum(self.per_file[slug].values())

    def grand_total(self):
        return sum(self.total(s) for s in self.per_file)

    def grand_by_prefix(self, prefix):
        return sum(
            v for bucket in self.per_file.values()
            for k, v in bucket.items() if k.startswith(prefix + ":")
        )


def rep(text, old, new, label, stats, required=False):
    n = text.count(old)
    if required and n == 0:
        raise RuntimeError("必做替换未命中: %s\n原文片段: %r" % (label, old[:120]))
    if n:
        text = text.replace(old, new)
        stats.add(label, n)
    return text


def rerep(text, pattern, repl, label, stats, flags=0, required=False, count=None):
    rx = re.compile(pattern, flags)
    text, n = rx.subn(repl, text)
    if required and n == 0:
        raise RuntimeError("必做正则替换未命中: %s (%r)" % (label, pattern[:120]))
    if count is not None and n != count:
        raise RuntimeError("正则替换 %s 命中 %d 次，预期 %d 次" % (label, n, count))
    stats.add(label, n)
    return text


# ================== 多 Agent / Claude Code 专有表述改写 ==================
# 每条 (label, old, new)；这些是原文精确片段，命中后整体替换。
EXACT = [
    # ---- investment-team ----
    ("multi:Team工具表述",
     "使用 Team 工具创建真正的多Agent并行研究团队。",
     "在同一条消息中并发发起多个 `subagent` 调用（DSH subagent 工具），组建多 Agent 并行研究小组："
     "子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些信息，必须在每个提示词里写清。"),
    ("multi:TeamCreate",
     "使用 TeamCreate 创建团队：\n"
     "- team_name: `{公司名}-research`（英文小写，如 `meituan-research`）\n"
     "- agent_type: `team-lead`",
     "使用 DSH `subagent` 工具组建并行研究小组（DSH 没有常驻 team 对象；团队名只作为报告标题与目录命名约定保留；"
     "子 agent 之间不共享上下文，返回摘要即止）：\n"
     "- group_name: `{公司名}-research`（英文小写，如 `meituan-research`）\n"
     "- 协调者: 你（相当于原 team-lead，负责统筹、汇总、输出最终报告）"),
    ("multi:TaskCreate",
     "使用 TaskCreate 创建以下4个任务（每个都要有 subject、description、activeForm）：",
     "按以下 4 个角色拆分任务（每个角色的 subject / description 直接作为对应 subagent 提示词的主体；"
     "activeForm 仅用于进度展示）："),
    ("multi:Agent配置块",
     "每个Agent的配置：\n"
     "- `subagent_type`: `general-purpose`\n"
     "- `run_in_background`: `true`\n"
     "- `team_name`: 对应团队名\n"
     "- `name`: 对应角色名（business-analyst / financial-analyst / industry-researcher / risk-assessor）",
     "每个 subagent 的配置：\n"
     "- 角色名（写进每个提示词首行）：对应角色名（business-analyst / financial-analyst / industry-researcher / risk-assessor）\n"
     "- 并发方式：与其它角色在**同一条消息**中并发发起 `subagent` 调用（DSH 没有常驻团队对象，subagent 一律同步并发返回）\n"
     "- 上下文：子 agent 之间不共享上下文，返回摘要即止；提示词必须自包含，需要汇总的字段在提示词里写清"),
    ("multi:Task工具并行启动",
     "使用 Task 工具同时启动4个Agent（**必须在同一条消息中并行调用**）：",
     "在同一条消息中并发发起 4 个 `subagent` 调用（**必须并行**）："),
    ("multi:TaskUpdate+SendMessage",
     "1. 使用 TaskUpdate 将任务 #{任务编号} 标记为 completed\n"
     "2. 通过 SendMessage 把完整分析报告发送给 team-lead（type: \"message\", recipient: \"team-lead\"）",
     "1. DSH 中无需标记任务状态（subagent 返回摘要即代表该角色完成）\n"
     "2. 把完整报告作为**返回摘要**交给协调者：DSH subagent 只能通过最终返回内容汇报，没有成员间点对点消息通道；"
     "提示词里必须写清要返回哪些字段、每条多长，正文超长部分写入文件并在摘要里给出路径"),
    ("multi:shutdown",
     "### 第六步：关闭团队成员\n\n"
     "全部报告收到后，向4个Agent发送 shutdown_request（使用 SendMessage，type: \"shutdown_request\"）。",
     "### 第六步：确认报告收齐\n\n"
     "DSH subagent 返回后自动结束，没有成员关闭流程；本步等价于确认 4 份返回摘要齐全。"),
    ("multi:TeamDelete",
     "### 第十步：清理团队\n\n使用 TeamDelete 清理团队资源。",
     "### 第十步：收尾\n\nDSH 没有常驻团队资源需要清理：subagent 返回后即结束，本步跳过。"),
    ("multi:注意事项并行",
     "1. **4个Agent必须并行启动**——在同一条消息中调用4次Task工具\n"
     "2. **Agent通过SendMessage汇报**——不是文件协作，是消息通信",
     "1. **4 个 subagent 必须并行启动**——在同一条消息中并发发起 4 个 `subagent` 调用\n"
     "2. **Agent 通过 subagent 返回值汇报**——不是文件协作，是摘要通信"),
    # ---- news-pulse ----
    ("multi:TeamCreate",
     "使用 TeamCreate 创建团队：\n"
     "- `team_name`: `{公司名}-newspulse`（英文小写，如 `pdd-newspulse`）\n"
     "- `agent_type`: `team-lead`",
     "使用 DSH `subagent` 工具组建并行侦察小组（DSH 没有常驻 team 对象；团队名只作为报告标题与目录命名约定保留；"
     "子 agent 之间不共享上下文，返回摘要即止）：\n"
     "- group_name: `{公司名}-newspulse`（英文小写，如 `pdd-newspulse`）\n"
     "- 协调者: 你（相当于原 team-lead，负责统筹、汇总、输出归因报告）"),
    ("multi:TaskCreate",
     "使用 TaskCreate 创建以下 4 个任务：",
     "按以下 4 个角色拆分侦察任务（每个角色的 subject / description 直接作为对应 subagent 提示词的主体）："),
    ("multi:Agent配置块",
     "**必须在同一条消息中并行调用 4 次 Task 工具**。每个 Agent 配置：\n"
     "- `subagent_type`: `general-purpose`\n"
     "- `run_in_background`: `true`\n"
     "- `team_name`: `{公司名}-newspulse`\n"
     "- `name`: 对应角色名（company-event-scout / regulatory-watcher / industry-peer-analyst / sentiment-tracker）",
     "**必须在同一条消息中并发发起 4 个 `subagent` 调用**。每个 subagent 的配置：\n"
     "- 角色名（写进每个提示词首行）：对应角色名（company-event-scout / regulatory-watcher / industry-peer-analyst / sentiment-tracker）\n"
     "- 并发方式：与其它角色在**同一条消息**中并发发起（DSH 没有常驻团队对象，subagent 一律同步并发返回）\n"
     "- 上下文：子 agent 之间不共享上下文，返回摘要即止；提示词必须自包含，需要汇总的字段在提示词里写清"),
    ("multi:TaskUpdate+SendMessage",
     "1. 使用 TaskUpdate 将任务标记为 completed\n"
     "2. 通过 SendMessage 把完整侦察报告发送给 team-lead（type: \"message\", recipient: \"team-lead\"）",
     "1. DSH 中无需标记任务状态（subagent 返回摘要即代表该角色完成）\n"
     "2. 把完整侦察报告作为**返回摘要**交给协调者：DSH subagent 只能通过最终返回内容汇报，没有成员间点对点消息通道；"
     "提示词里必须写清要返回哪些字段、每条多长，正文超长部分写入文件并在摘要里给出路径"),
    ("multi:shutdown",
     "- 全部到齐后，通过 SendMessage 向 4 个 Agent 发送 shutdown_request",
     "- 全部到齐即完成（DSH subagent 返回后自动结束，无成员关闭流程）"),
    # ---- private-company-research ----
    ("multi:TeamCreate",
     "使用 TeamCreate 创建团队：\n"
     "- team_name: `{公司名}-private-research`（英文小写，如 `ant-group-private-research`）\n"
     "- agent_type: `team-lead`",
     "使用 DSH `subagent` 工具组建并行研究小组（DSH 没有常驻 team 对象；团队名只作为报告标题与目录命名约定保留；"
     "子 agent 之间不共享上下文，返回摘要即止）：\n"
     "- group_name: `{公司名}-private-research`（英文小写，如 `ant-group-private-research`）\n"
     "- 协调者: 你（相当于原 team-lead，负责统筹、汇总、输出最终报告）"),
    ("multi:TaskCreate",
     "使用 TaskCreate 创建以下6个任务（每个都要有 subject、description、activeForm）：",
     "按以下 6 个角色拆分任务（每个角色的 subject / description 直接作为对应 subagent 提示词的主体；"
     "activeForm 仅用于进度展示）："),
    ("multi:Agent工具并行启动",
     "使用 Agent 工具同时启动6个Agent（**必须在同一条消息中并行调用**）：",
     "在同一条消息中并发发起 6 个 `subagent` 调用（**必须并行**）："),
    ("multi:Agent配置块",
     "每个Agent的配置：\n"
     "- `subagent_type`: `general-purpose`\n"
     "- `run_in_background`: `true`",
     "每个 subagent 的配置：\n"
     "- 角色名（写进每个提示词首行）：对应角色名\n"
     "- 并发方式：与其它角色在**同一条消息**中并发发起 `subagent` 调用（DSH 没有常驻团队对象，subagent 一律同步并发返回）\n"
     "- 上下文：子 agent 之间不共享上下文，返回摘要即止；提示词必须自包含，需要汇总的字段在提示词里写清"),
    ("multi:TeamDelete",
     "使用 TeamDelete 清理团队资源。",
     "DSH 没有常驻团队资源需要清理：subagent 返回后即结束，本步跳过。"),
    ("multi:注意事项并行",
     "1. **6个Agent必须并行启动**——在同一条消息中调用6次Agent工具",
     "1. **6 个 subagent 必须并行启动**——在同一条消息中并发发起 6 个 `subagent` 调用"),
    # ---- Task 工具（单处改写） ----
    ("multi:Task工具",
     "使用 Task 工具启动多个后台 Agent **并行**获取以下原始材料：",
     "使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，并行获取以下原始材料"
     "（子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）："),
    ("multi:Task工具",
     "使用 Task 工具启动多个后台 Agent **并行**收集以下数据：",
     "使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，并行收集以下数据"
     "（子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）："),
    ("multi:Task工具",
     "使用 Task 工具启动后台 Agent，全面搜索该行业所有上市公司。",
     "使用 DSH `subagent` 工具（同一条消息中并发发起多个 subagent 调用）全面搜索该行业所有上市公司；"
     "子 agent 之间不共享上下文，返回摘要即止，需要汇总的字段在提示词里写清。"),
    ("multi:Task工具",
     "使用 Task 工具为**每家公司**启动独立的后台 Agent 进行数据收集（所有公司同时并行启动），每个Agent负责收集：",
     "使用 DSH `subagent` 工具为**每家公司**在**同一条消息**中并发发起独立 subagent 调用进行数据收集，"
     "每个 subagent 负责收集（子 agent 之间不共享上下文，返回摘要即止）："),
    ("multi:Task工具",
     "使用 Task 工具启动后台 Agent，从网络收集以下数据：",
     "使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，从网络收集以下数据"
     "（子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）："),
    ("multi:Task工具",
     "使用 Task 工具启动后台 Agent，通过 WebSearch 为每个持仓并行获取：",
     "使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，通过 `web_search` "
     "为每个持仓并行获取（子 agent 之间不共享上下文，返回摘要即止）："),
    # ---- Agent 工具（非 Task 写法） ----
    ("multi:Agent工具",
     "使用 Agent 工具启动后台 Agent **并行**获取以下原始材料：",
     "使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，并行获取以下原始材料"
     "（子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）："),
    ("multi:Agent工具",
     "使用 Agent 工具在**同一条消息**中启动4个后台 Agent。",
     "在同一条消息中并发发起 4 个 `subagent` 调用（子 agent 之间不共享上下文，返回摘要即止）。"),
    ("multi:Agent工具",
     "研究报告完成后，**并行**启动两个 Agent：",
     "研究报告完成后，**在同一条消息中并发发起两个 `subagent` 调用**："),
    ("multi:Agent工具",
     "使用 Agent 工具**并行**启动2-3个研究Agent，收集足够的素材：",
     "在同一条消息中并发发起 2-3 个 `subagent` 调用（DSH subagent 工具），收集足够的素材："),
    ("multi:Agent工具",
     "使用 Agent 工具启动**作者Agent**，给出详细的写作指令。",
     "发起一个 `subagent` 调用充当**作者Agent**，给出详细的写作指令（提示词必须自包含，返回值即初稿摘要/文件路径）。"),
    ("multi:Agent工具",
     "使用 Agent 工具在**同一条消息**中启动编辑Agent和读者Agent。",
     "在同一条消息中并发发起编辑Agent与读者Agent两个 `subagent` 调用。"),
    ("multi:Agent工具",
     "派 Explore agent 并行扫描全系列做以下检查：",
     "在同一条消息中并发发起多个 `subagent` 调用，并行扫描全系列做以下检查："),
    ("multi:Agent工具",
     "为每家公司启动独立后台Agent，使用 WebSearch 搜索以下数据：",
     "为每家公司启动独立的 `subagent`（在**同一条消息**中并发发起调用），使用 `web_search` 搜索以下数据："),
    ("multi:Agent工具",
     "1. 数据规模大时，按产业链环节并行派出研究 Agent（每环节一个），要求联网获取最新财报与高频数据，返回结构化事实（数据+出处），不返回观点。",
     "1. 数据规模大时，按产业链环节在同一条消息中并发发起多个 `subagent` 调用（每环节一个），要求联网获取最新财报与高频数据，"
     "返回结构化事实（数据+出处），不返回观点；子 agent 之间不共享上下文，返回摘要即止。"),
    # ---- 通用收尾/配置短语 ----
    ("multi:任务状态与汇报",
     "将资料可得性评级告知每个 Agent，影响其分析深度。",
     "将资料可得性评级告知每个 subagent，影响其分析深度。"),
    ("multi:任务状态与汇报",
     "将评级告知每个 Agent，影响其侦察方式。",
     "将评级告知每个 subagent，影响其侦察方式。"),
    ("multi:任务状态与汇报",
     "如果用户只说了公司名，先反问：",
     "如果用户只说了公司名，先反问："),
]

# investment-team 里“第一步¾：WebSearch 权限预检”整节（Claude Code 专有白名单机制）
OLD_PERM_SECTION = (
    "### 第一步¾：WebSearch 权限预检（关键 · 避免 Agent 静默退化）\n"
)
NEW_PERM_SECTION = """### 第一步¾：联网能力预检（关键 · 避免 subagent 静默退化）

在启动任何 subagent **之前**，必须先按「第〇步：联网可用性预检」确认本会话的 `web_search` / `web_fetch` 真实可用。

**为什么必须预检**：本 skill 会在同一条消息中并发发起 4 个 subagent，subagent 无法向你弹出交互式确认。若 `web_search` 在本轮不可用，子 agent 的联网检索会被**静默降级**为仅凭训练知识（有知识截止日期）作答，却仍按框架输出一份"看起来完整、实则未联网"的伪研究——这是本 skill 最危险的失败模式（见原项目 issue #58）。

**预检步骤**：
1. 按「第〇步」做一次检索探针，确认返回真实结果。
2. 若探针失败（工具不存在、被拦截、无返回）→ **停下来，不要发起 subagent**，明确告知用户：**「本轮无联网能力，无法产出可信研报」**，并说明可以做什么（框架讨论/方法论梳理），不产出含数据的结论。
3. 探针通过 → 正常继续。

> DSH 说明：Claude Code 用配置文件白名单放行联网工具，DSH 没有这层白名单机制，联网权限由本会话实际可用的工具决定，因此预检方式是**实际调用一次**，而不是查配置文件。详见 `docs/ADAPTATION.md`。
"""


def transform(slug, text, stats):
    stats.start(slug)
    text = strip_frontmatter(text, stats)

    # ---------- C3 多 Agent / Claude Code 结构改写 ----------
    for label, old, new in EXACT:
        if old == new:      # 占位项（保留原文语义，不计数）
            continue
        text = rep(text, old, new, label, stats)

    # investment-team：整节白名单预检 → DSH 联网探针
    text, n = re.subn(
        r"### 第一步¾：WebSearch 权限预检[^\n]*\n.*?\n(?=### 第二步：创建团队)",
        NEW_PERM_SECTION + "\n",
        text,
        flags=re.S,
    )
    stats.add("multi:permissions白名单节改写", n)

    # 兜底：仍残留的 Claude Code 专有 token
    text = rerep(text, r"使用\s*Task\s*工具", "使用 DSH `subagent` 工具", "multi:Task工具兜底", stats)
    text = rerep(text, r"(\d+)个并行研究Agent", r"\1 个并行 subagent", "multi:角色短语", stats)
    text = rerep(text, r"(\d+)个Agent", r"\1 个 subagent", "multi:角色短语", stats)
    text = rerep(text, r"每个Agent", "每个 subagent", "multi:角色短语", stats)
    text = rerep(text, r"后台子? Agent", "subagent", "multi:角色短语", stats)
    text = rerep(text, r"每个 Agent 配置", "每个 subagent 的配置", "multi:角色短语", stats)

    # ---------- C8 工具名映射 ----------
    text = rerep(text, r"WebSearch", "web_search", "tool:WebSearch→web_search", stats)
    text = rerep(text, r"WebFetch", "web_fetch", "tool:WebFetch→web_fetch", stats)
    text = rerep(text, r"\bBash\b", "pwsh", "tool:Bash→pwsh", stats)

    # ---------- C2 $ARGUMENTS ----------
    text = rerep(text, r"\$\{?ARGUMENTS\}?", TARGET, "args:$ARGUMENTS", stats)

    # ---------- C6 误差阈值统一 1% ----------
    text = rep(
        text, "误差>1%须标记", "误差>1%须标记（对应 `--tolerance 1.0`）",
        "tol:误差阈值标注", stats,
    )
    text = rep(
        text,
        "flag discrepancies above 1%.",
        "flag discrepancies above 1% (pass `--tolerance 1.0` to `tools\\financial_rigor.py cross-validate`;"
        " the tool default is 2.0).",
        "tol:误差阈值标注", stats,
    )
    text, n = add_tolerance(text)
    stats.add("tol:cross-validate补--tolerance 1.0", n)

    # ---------- C4 python3 / tools 路径（Windows） ----------
    text = rep(text, "python3 tools/", "python tools\\", "win:python3→python + 路径分隔符", stats)
    text = rerep(text, r"python3\s+", "python ", "win:python3→python", stats)
    text = rep(text, "tools/", "tools\\", "win:tools路径分隔符", stats)

    # ---------- C8 技能路径 / 斜杠命令 ----------
    text = rerep(text, r"skills/([a-z0-9\-]+)\.md", r"skills/\1/SKILL.md", "path:skills/*.md", stats)
    slug_alt = "|".join(re.escape(s) for s in SLUGS)
    text = rerep(text, r"`(%s)\.md`" % slug_alt, r"`\1 技能`", "path:技能md引用", stats)
    text = rerep(text, r"(?<![\w/\-])/(%s)(?![\w\-])" % slug_alt, r"\1 技能", "path:斜杠命令→技能", stats)

    # ---------- C7 落盘路径 ----------
    text = rep(text, "~/", "reports/", "path:~/→reports/", stats)
    text = rep(text, "/tmp/", "$env:TEMP\\", "path:/tmp/→$env:TEMP\\", stats)

    # ---------- C8 其他 Claude Code 专有引用 ----------
    text = rerep(text, r"CLAUDE\.md", "AGENTS.md", "tool:CLAUDE.md→AGENTS.md", stats)
    text = rerep(text, r"本\s*[Ss]kill[ \t]*", "本技能", "misc:本Skill→本技能", stats)

    # deep-company-series 的 grep|head 私隐扫描（Unix 专属）改 pwsh
    text = rep(
        text,
        "```bash\n# 推送前必须本地 grep 一次（按 ai-berkshire 隐私规则）\n"
        "grep -r \"<本机用户名>\\|/Users/\\|<个人身份信息>\" reports/ | head\n```",
        "```powershell\n# 推送前必须本地扫描一次（按 ai-berkshire 隐私规则）\n"
        "Get-ChildItem reports -Recurse -File | Select-String -Pattern '<本机用户名>','/Users/','<个人身份信息>' | Select-Object -First 20\n```",
        "win:grep/head→Select-String", stats,
    )

    # ---------- C5 第〇步联网预检 ----------
    text = insert_preflight(text, slug, stats)

    # ---------- C1 DSH frontmatter ----------
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.lstrip("\n")
    text = build_frontmatter(slug, stats) + text
    if not text.endswith("\n"):
        text += "\n"
    return text


# ========================= 校验 =========================
BANNED = [
    (r"\$ARGUMENTS", "$ARGUMENTS"),
    (r"TeamCreate", "TeamCreate"),
    (r"TaskCreate", "TaskCreate"),
    (r"TaskUpdate", "TaskUpdate"),
    (r"TeamDelete", "TeamDelete"),
    (r"SendMessage", "SendMessage"),
    (r"shutdown_request", "shutdown_request"),
    (r"python3\s+tools", "python3 tools"),
    (r"subagent_type", "subagent_type"),
    (r"run_in_background", "run_in_background"),
    (r"general-purpose", "general-purpose"),
    (r"Explore agent", "Explore agent"),
    (r"\.claude", ".claude"),
    (r"CLAUDE\.md", "CLAUDE.md"),
    (r"permissions\.allow", "permissions.allow"),
]


def validate(slug, text):
    problems = []
    meta, _body = parse_frontmatter(text)
    for key in ("name", "description", "whenToUse"):
        if key not in meta:
            problems.append("frontmatter 缺 %s" % key)
    if meta.get("name") != slug:
        problems.append("frontmatter name != slug (%r)" % meta.get("name"))
    for key in ("description", "whenToUse"):
        if ": " in meta.get(key, ""):
            problems.append("frontmatter %s 含 YAML 不安全的 ': '" % key)
        if "\t" in meta.get(key, ""):
            problems.append("frontmatter %s 含 tab" % key)
    if text.count("## 第〇步：联网可用性预检") != 1:
        problems.append("第〇步预检段落数 != 1")
    for pattern, literal in BANNED:
        if re.search(pattern, text):
            problems.append("残留 %s" % literal)
    if "误差>1%须标记（对应 `--tolerance 1.0`）" not in text and "交叉验证" in text:
        pass  # 只有原文含该短语的文件才要求
    return problems


# ========================= 主流程 =========================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="忽略缓存重新下载源文件")
    args = ap.parse_args()

    started = _dt.datetime.now().astimezone()
    skills_cache = os.path.join(CACHE, "skills")
    tools_cache = os.path.join(CACHE, "tools")
    os.makedirs(skills_cache, exist_ok=True)
    os.makedirs(tools_cache, exist_ok=True)

    # 源仓库 commit（写进 ADAPTATION.md 存档）
    sha = "unknown"
    try:
        req = urllib.request.Request(API_COMMIT, headers={"User-Agent": "dsh-adapt/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            sha = json.loads(resp.read().decode("utf-8"))["sha"]
    except Exception:  # noqa: BLE001 - 拿不到就用缓存里的
        meta_file = os.path.join(CACHE, "meta.txt")
        if os.path.exists(meta_file):
            sha = open(meta_file, encoding="utf-8").read().strip() or "unknown"
    try:
        with open(os.path.join(CACHE, "meta.txt"), "w", encoding="utf-8") as fh:
            fh.write(sha + "\n")
    except OSError:
        pass

    stats = Stats()
    rows = []
    skill_out = out_path("skills")
    for slug in SLUGS:
        src = os.path.join(skills_cache, slug + ".md")
        fetch(RAW + "skills/" + slug + ".md", src, refresh=args.refresh)
        original = read_text(src)
        new_text = transform(slug, original, stats)
        dest = os.path.join(skill_out, slug, "SKILL.md")
        problems = validate(slug, new_text)
        if problems:
            raise RuntimeError("%s 校验失败:\n  - %s" % (slug, "\n  - ".join(problems)))
        write_text(dest, new_text)
        rows.append({
            "slug": slug,
            "orig_bytes": len(original.encode("utf-8")),
            "out_bytes": len(new_text.encode("utf-8")),
            "orig_lines": len(original.split("\n")) - (1 if original.endswith("\n") else 0),
            "out_lines": len(new_text.split("\n")) - (1 if new_text.endswith("\n") else 0),
            "reps": stats.total(slug),
            "counts": dict(sorted(stats.per_file[slug].items())),
        })

    # tools/ 原样拷贝（字节保持一致，便于溯源）
    tool_rows = []
    for name in TOOLS:
        src = os.path.join(tools_cache, name)
        size = fetch(RAW + "tools/" + name, src, refresh=args.refresh)
        dest = out_path("tools", name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(src, "rb") as fh:
            data = fh.read()
        with open(dest, "wb") as fh:
            fh.write(data)
        tool_rows.append({"name": name, "bytes": len(data)})

    finished = _dt.datetime.now().astimezone()
    write_adaptation(rows, tool_rows, stats, sha, started, finished)

    # 控制台摘要（仅 ASCII + 路径）
    print("skills ->", len(rows), "files,", sum(r["out_bytes"] for r in rows), "bytes")
    print("tools  ->", len(tool_rows), "files,", sum(r["bytes"] for r in tool_rows), "bytes")
    print("replacements total:", stats.grand_total())
    for r in rows:
        print("  %-24s %6d -> %6d bytes  %3d replacements" % (
            r["slug"], r["orig_bytes"], r["out_bytes"], r["reps"]))
    print("source commit:", sha)
    print("output:", PKG)


# ========================= ADAPTATION.md =========================
CATEGORY = [
    ("C1 DSH frontmatter", "frontmatter:"),
    ("C2 $ARGUMENTS → 标的占位", "args:"),
    ("C3 多 Agent → 并发 subagent", "multi:"),
    ("C4 python3 / tools 路径 Windows 化", "win:"),
    ("C5 第〇步联网可用性预检", "preflight:"),
    ("C6 误差阈值统一 1% / --tolerance 1.0", "tol:"),
    ("C7 报告落盘路径", "path:"),
    ("C8 附加可移植性修补（工具名/斜杠命令/技能路径/AGENTS.md 等）", "tool:"),
    ("C8 附加可移植性修补（misc）", "misc:"),
]


def write_adaptation(rows, tool_rows, stats, sha, started, finished):
    lines = []
    add = lines.append
    add("# ai-berkshire → DeepSeek Harness 技能改造说明")
    add("")
    add("本包把 [xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire) 的 21 个 Claude Code skill")
    add("机械改造成 DSH 原生技能（`skills/<slug>/SKILL.md`），并原样收录 `tools/` 下的 Python 工具。")
    add("")
    add("| 项 | 值 |")
    add("|----|----|")
    add("| 源仓库 | `%s`（分支 `%s`） |" % (REPO, BRANCH))
    add("| 源 commit | `%s` |" % sha)
    add("| 抓取开始 / 完成 | %s / %s |" % (
        started.strftime("%Y-%m-%d %H:%M:%S %z"),
        finished.strftime("%Y-%m-%d %H:%M:%S %z"),
    ))
    add("| 源 skill 数 | %d（`skills/*.md`） |" % len(rows))
    add("| 源 tools | %d 个（`tools/*`，另跳过 %s 字体文件；清单中的 `star-test` 不存在） |"
        % (len(tool_rows), ", ".join("`%s`" % t for t in SKIPPED_TOOLS)))
    add("| 改造后总字节 | %d |" % sum(r["out_bytes"] for r in rows))
    add("| 替换项总数 | %d |" % stats.grand_total())
    add("| 生成脚本 | [`docs/adapt_skills.py`](adapt_skills.py)（可重跑，源文件有本地缓存） |")
    add("")
    add("> 改造只做机械替换：**不新增、不删除任何方法论内容**，正文逐字保留；")
    add("> 45KB 的 `private-company-research` 全文完整保留，未做任何截断。")
    add("")
    add("## 一、逐文件改造统计")
    add("")
    add("| slug | 原字节 | 改造后字节 | 原行数 | 改造后行数 | 替换项 | 主要替换项 |")
    add("|------|-------:|----------:|------:|----------:|------:|-----------|")
    for r in rows:
        main_labels = ", ".join(
            "%s×%d" % (k.split(":", 1)[1], v)
            for k, v in sorted(r["counts"].items(), key=lambda kv: -kv[1])[:3]
        )
        add("| `%s` | %d | %d | %d | %d | %d | %s |" % (
            r["slug"], r["orig_bytes"], r["out_bytes"],
            r["orig_lines"], r["out_lines"], r["reps"], main_labels,
        ))
    add("| **合计** | **%d** | **%d** | **%d** | **%d** | **%d** | |" % (
        sum(r["orig_bytes"] for r in rows),
        sum(r["out_bytes"] for r in rows),
        sum(r["orig_lines"] for r in rows),
        sum(r["out_lines"] for r in rows),
        stats.grand_total(),
    ))
    add("")
    add("### tools/（原样拷贝，字节完全一致）")
    add("")
    add("| 文件 | 字节 |")
    add("|------|-----:|")
    for t in tool_rows:
        add("| `tools/%s` | %d |" % (t["name"], t["bytes"]))
    add("")
    add("## 二、7 类机械替换的 before / after")
    add("")
    add("### C1 顶部补 DSH frontmatter（`name` / `description` / `whenToUse`）")
    add("")
    add("原文只有 `news-pulse` 带 Claude 风格 frontmatter，其余 20 个无 frontmatter。")
    add("")
    add("```yaml")
    add("# before（news-pulse.md 原文，无 whenToUse，且描述含未转义冒号）")
    add("---")
    add("name: news-pulse")
    add("description: 公司新闻脉搏：股价异动时快速归因。用 4 个并行 Agent 侦察公司事件/监管政策/行业对手/市场情绪，产出\"事件时间线 + 异动主因判断 + 是否触发论文重审\"。")
    add("---")
    add("")
    add("# after（21 个文件统一为三键；description 使用全角冒号，YAML 安全）")
    add("---")
    add("name: news-pulse")
    add("description: 公司新闻脉搏：股价异动时快速归因，4 个并行 Agent 侦察公司事件/监管政策/行业对手/市场情绪，产出事件时间线与异动主因判断。")
    add("whenToUse: 新闻归因, 股价异动, 大涨大跌, 事件侦察, 新闻脉搏, 异动归因")
    add("---")
    add("```")
    add("")
    add("### C2 `$ARGUMENTS` → 标的占位")
    add("")
    add("```diff")
    add("- 对 $ARGUMENTS 进行财报精读分析。")
    add("+ 对 用户本轮指定的标的（从对话上下文取；缺失就先反问，不要编造） 进行财报精读分析。")
    add("```")
    add("")
    add("### C3 多 Agent：Task / TeamCreate / TaskCreate / SendMessage → DSH subagent")
    add("")
    add("```diff")
    add("- 使用 Task 工具启动多个后台 Agent **并行**获取以下原始材料：")
    add("+ 使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，并行获取以下原始材料")
    add("+ （子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）：")
    add("")
    add("- 使用 TeamCreate 创建团队：")
    add("- - team_name: `{公司名}-research`（英文小写，如 `meituan-research`）")
    add("- - agent_type: `team-lead`")
    add("+ 使用 DSH `subagent` 工具组建并行研究小组（DSH 没有常驻 team 对象；团队名只作为报告标题与目录命名约定保留；")
    add("+ 子 agent 之间不共享上下文，返回摘要即止）：")
    add("+ - group_name: `{公司名}-research`（英文小写，如 `meituan-research`）")
    add("+ - 协调者: 你（相当于原 team-lead，负责统筹、汇总、输出最终报告）")
    add("```")
    add("")
    add("角色划分、任务编号与每个角色负责的维度、并行/串行顺序、阶段产物文件名（如")
    add("`reports/{公司名}/{公司名}-earnings-{期间}.md`）全部保持不变。")
    add("")
    add("### C4 `python3 tools/xxx.py` → `python tools\\xxx.py`")
    add("")
    add("```diff")
    add("- python3 tools/financial_rigor.py cross-validate \\")
    add("-   --metric \"revenue\" --values 108.3e9 107.9e9 --sources \"公司财报\" \"Yahoo Finance\"")
    add("+ python tools\\financial_rigor.py cross-validate \\")
    add("+   --metric \"revenue\" --values 108.3e9 107.9e9 --sources \"公司财报\" \"Yahoo Finance\" --tolerance 1.0")
    add("```")
    add("")
    add("`bash` 代码围栏保留（其中的 python 命令在 pwsh 下可直接运行）；仅")
    add("`deep-company-series` 里一处纯 Unix 的 `grep -r ... | head` 改成等价 pwsh")
    add("`Get-ChildItem ... | Select-String ... | Select-Object -First 20`。")
    add("")
    add("### C5 每个 SKILL.md 的「第〇步：联网可用性预检」（原 issue #58 红线）")
    add("")
    add("```markdown")
    add("## 第〇步：联网可用性预检")
    add("")
    add("**本步骤先于一切取数与分析，不可跳过。**")
    add("")
    add("1. 确认本轮会话中 `web_search` 与 `web_fetch` 工具**实际可用**：先用一次无害的检索探针验证调用能真实返回结果。")
    add("2. 若任一工具不可用、调用被拦截或无返回，**立即停止**，明确告知用户：**「本轮无联网能力，无法产出可信研报」**……")
    add("3. **禁止凭记忆编造数据**：……原项目 issue #58 的失败模式正是检索被静默拦截后仍输出完整研报——宁可中止，不可伪装。")
    add("4. 引用来源必须是**本轮实际抓取到的 URL**……")
    add("5. 每份报告末尾必须有**「数据来源与抓取时间」**表……")
    add("```")
    add("")
    add("插入位置按各文件结构固定：有 `## 执行流程` 的插在标题后，以 `## 第一步` / `## 阶段一` 开头的插在首个步骤前")
    add("（逐文件锚点见 `adapt_skills.py` 的 `ANCHORS`）。")
    add("")
    add("### C6 误差阈值统一 1%（原文 1% vs 工具默认 2.0 的矛盾）")
    add("")
    add("```diff")
    add("- 每个关键数据必须来自两个独立来源，误差>1%须标记。")
    add("+ 每个关键数据必须来自两个独立来源，误差>1%须标记（对应 `--tolerance 1.0`）。")
    add("")
    add("- python3 tools/financial_rigor.py cross-validate --field {字段} --values '{JSON}' --unit {单位}")
    add("+ python tools\\financial_rigor.py cross-validate --field {字段} --values '{JSON}' --unit {单位} --tolerance 1.0")
    add("```")
    add("")
    add("已核实 `tools/financial_rigor.py` 的 `--tolerance` 默认值为 2.0，与 skill 文本的 1% 不一致；")
    xv = sum(v for bucket in stats.per_file.values() for k, v in bucket.items()
             if k.startswith("tol:cross-validate"))
    add("改造后**全部 %d 处 `cross-validate` 命令都显式传 `--tolerance 1.0`**，工具本体保持上游原样未改。" % xv)
    add("")
    add("### C7 报告落盘路径统一到当前工作区 `reports/`")
    add("")
    add("```diff")
    add("- 将完整最终报告写入 `~/{公司名}投资研究报告_{日期}.md`（日期格式 YYYYMMDD）。")
    add("+ 将完整最终报告写入 `reports/{公司名}投资研究报告_{日期}.md`（日期格式 YYYYMMDD）。")
    add("")
    add("- 命令示例：`... --output /tmp/dyp-{公司名}.md`")
    add("+ 命令示例：`... --output $env:TEMP\\dyp-{公司名}.md`")
    add("```")
    add("")
    add("原文已经写 `reports/` 的保持不变；4 处 `~/` 输出路径改为 `reports/`，2 处 `/tmp/` 改为 `$env:TEMP\\`。")
    add("")
    add("## 三、附加可移植性修补（C8，不涉及方法论）")
    add("")
    add("| 原文（Claude Code 生态） | 改造后（DSH 生态） | 说明 |")
    add("|--------------------------|--------------------|------|")
    add("| `WebSearch` / `WebFetch` | `web_search` / `web_fetch` | 工具名对齐 DSH |")
    add("| `Bash` 工具 | `pwsh` 工具 | DSH 在 Windows 上的命令执行工具 |")
    add("| `/investment-team` 等斜杠命令 | `investment-team 技能` | DSH 技能按名称调用，无自定义 slash 命令 |")
    add("| `skills/financial-data.md` | `skills/financial-data/SKILL.md` | 指向本包真实路径 |")
    add("| `CLAUDE.md` 客观性原则 | `AGENTS.md` 客观性原则 | DSH 的项目规范文件名 |")
    add("| `本 Skill` | `本技能` | 术语统一 |")
    add("| `TeamCreate` / `TaskCreate` / `TaskUpdate` / `TeamDelete` / `SendMessage` / `shutdown_request` | 并发 `subagent` + 返回值摘要 | DSH 无这些工具 |")
    add("| `subagent_type: general-purpose` / `run_in_background: true` | 提示词自包含 + 同一条消息并发 | DSH subagent 无这些参数 |")
    add("| `Explore agent` | `subagent` | DSH 只有一种子 agent |")
    add("| `permissions.allow` 白名单预检（investment-team） | 实际调用一次检索探针 | DSH 无该白名单机制 |")
    add("")
    add("## 四、已知无法改造 / 需人工注意的点")
    add("")
    add("1. **`permissions.allow` 白名单机制在 DSH 不存在。** 原文 `investment-team` 第一步¾ 让模型 grep")
    add("   `.claude/settings.local.json` 确认 `WebSearch` 被放行，DSH 没有这层白名单（工具可用性由会话/插件授权决定）。")
    add("   改造后该节改为「按第〇步实际调用一次检索探针」，保留原失败模式说明与 issue #58 引用。")
    add("2. **`TeamCreate` / `TaskCreate` / `TaskUpdate` / `TeamDelete` / `SendMessage` / `shutdown_request` 在 DSH 无对应物。**")
    add("   DSH 的 subagent 是一次性、无共享上下文的调用，返回摘要即结束。原文的 team/任务看板/成员间消息通信")
    add("   改为「同一条消息并发 subagent + 提示词写清要汇总的字段」。因此原文里「Agent 之间通过 SendMessage 协作」")
    add("   的实时进度展示能力弱化为「按返回顺序汇总」——这是工具能力差异，不是方法论改动。")
    add("3. **`run_in_background: true` 无对应参数。** DSH subagent 默认同步并发；原文里「后台 Agent 无法弹出交互式确认」")
    add("   的困境在 DSH 中同样存在（subagent 不能向用户确认），所以第〇步的探针必须在**发起 subagent 之前**由主 agent 完成。")
    add("4. **`/income-investment \"<company>\" [mode=...]` 这类命令式调用**在 DSH 中是「把参数写进对话」。")
    add("   原文的用法行保留为说明文本，调用时由用户自然语言给出标的与模式。")
    add("5. **`wechat-article` 依赖 poppler 的 `pdftoppm` / `pdftotext` 把论文 PDF 渲成 PNG**，Windows 默认没有")
    add("   这些命令，需要自行安装 Poppler（或改用其它 PDF 转图工具）。命令里的输出目录已从 `/tmp/` 改为 `$env:TEMP\\`。")
    add("6. **`tools/xueqiu_scraper.py`** 抓雪球需要网络与 cookie，原文未给凭据管理方案，本包未做改动（原样拷贝）。")
    add("7. **`tools/` 未改一行代码**，包括 `financial_rigor.py` 的 `--tolerance` 默认值 2.0；")
    add("   冲突按「skill 文本显式传 `--tolerance 1.0`」解决，避免上游工具行为漂移，便于日后同步上游。")
    add("8. **源仓库的 `CLAUDE.md`、`.claude/` 配置、`commands/` 等 Claude Code 专属资产未收录**；")
    add("   本包只收录 `skills/*.md` 与 `tools/*`。")
    add("9. **`dyp-ask` 是人格扮演类 skill**，没有取数流程；第〇步预检只在其需要联网核实事实/最新言论时生效，")
    add("   不改变其「不懂就说不懂」的红线。")
    add("10. **报告目录 `reports/` 需存在**：DSH 的 write 工具会自动建目录；若用 Python 工具写盘，脚本自行处理。")
    add("")
    add("## 五、交付前自检结果")
    add("")
    add("由 `adapt_skills.py` 在生成时逐文件执行，全部通过才写盘：")
    add("")
    add("- 21 个 `skills/<slug>/SKILL.md` 全部生成；")
    add("- 逐个解析 frontmatter（不依赖 pyyaml），`name` / `description` / `whenToUse` 三键齐全，")
    add("  `description` / `whenToUse` 中无 YAML 不安全的 `\\\": \"` 与 tab；")
    add("- 每个文件 `## 第〇步：联网可用性预检` 恰好 1 次；")
    add("- 全文 grep 无残留：`$ARGUMENTS`、`TeamCreate`、`TaskCreate`、`TaskUpdate`、`TeamDelete`、")
    add("  `SendMessage`、`shutdown_request`、`python3 tools`、`subagent_type`、`run_in_background`、")
    add("  `general-purpose`、`Explore agent`、`.claude`、`CLAUDE.md`、`permissions.allow`。")
    add("")

    write_text(out_path("docs", "ADAPTATION.md"), "\n".join(lines))


if __name__ == "__main__":
    main()
