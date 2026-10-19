# -*- coding: utf-8 -*-
"""研究报告图表生成器。

契约见 docs/report-pipeline.md §3：

    python make_charts.py --spec <spec.json> --out-dir <dir> [--json] [--dpi 200] [--width-in 6.3]

设计要点
--------
1. 先校验后绘图：整份 spec 全部校验通过才动手，任何一张图报错则退出码 1、
   stderr 指明 chart id 与原因，out-dir 里不落任何 PNG（先渲染到临时目录，
   全部成功后再整体移动）。
2. 视觉规范全部取自 palette.py：白底、dpi 200、宽度默认 6.3in、微软雅黑、
   负号正常。每张图固定带左对齐标题、可选副标题、左下来源脚注。
3. 同一套版式函数保证所有图型的标题/脚注位置一致：标题与脚注都贴 figure
   左边（x=0），绘图区按英寸预留边距，避免不同图型之间忽左忽右。脚注在绘制
   完成后按 x 轴文字的实测下沿再下移一段，因此不会和刻度标签、轴标题重叠。

支持的 type
-----------
line / bar / barh / grouped_bar / stacked_bar / combo / scatter / bubble /
heatmap / waterfall / donut / area

通用可选字段（契约 §3）
-----------------------
subtitle / footnote / y_label / x_label / y_min / y_max / value_fmt /
annotate:[{text,x,y,color?,axis?,dx?,dy?}] / highlight / legend / grid /
size / reverse

为写报告方便，额外支持以下字段（均为可选，缺省时保持契约行为）：
    value_labels  是否在柱/点旁标数值（bar、barh、combo 单柱序列默认 True）
    tick_fmt      坐标轴刻度格式，如 "{:,.0f}"
    legend_ncol   图例列数
    color         单序列图（barh）的柱色
    cmap          heatmap 配色：matplotlib 名称，或 BLUE/TEAL/AMBER/RED/GREEN
                  （以白色到该色的顺序色阶解释）
    center        donut 圆心文字
    y_label_right / y_min_right / y_max_right   combo 右轴标签与范围
"""
import argparse
import json
import math
import os
import re
import shutil
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.colors import LinearSegmentedColormap
    from matplotlib.patches import Patch, Rectangle
    from matplotlib.ticker import FuncFormatter
except ImportError as _exc:  # pragma: no cover - 环境缺依赖时给出可读提示
    sys.stderr.write("make_charts.py 需要 matplotlib：%s\n" % _exc)
    sys.exit(1)

import palette  # noqa: E402

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

TYPES = (
    "line", "bar", "barh", "grouped_bar", "stacked_bar", "combo",
    "scatter", "bubble", "heatmap", "waterfall", "donut", "area",
)

INK = palette.color("INK")
GRID = palette.color("GRID")
GREY = palette.color("GREY")
BLUE = palette.color("BLUE")
TEAL = palette.color("TEAL")
AMBER = palette.color("AMBER")
RED = palette.color("RED")
GREEN = palette.color("GREEN")

# 单序列图型的默认高度（inch）；barh / heatmap 按条目数另行计算
DEFAULT_HEIGHT = {
    "line": 3.45,
    "area": 3.45,
    "bar": 3.40,
    "grouped_bar": 3.45,
    "stacked_bar": 3.45,
    "combo": 3.55,
    "scatter": 3.60,
    "bubble": 3.70,
    "waterfall": 3.60,
    "donut": 3.90,
    "barh": 3.40,
    "heatmap": 3.90,
}

plt = None  # 由 _setup() 延迟初始化，避免校验阶段就付导入成本


# ---------------------------------------------------------------------------
# 异常与格式化工具
# ---------------------------------------------------------------------------

class ChartError(Exception):
    """单张图的规格错误；消息里带 chart id 与 type。"""

    def __init__(self, chart_id, chart_type, message):
        self.chart_id = chart_id
        self.chart_type = chart_type
        self.message = message
        super(ChartError, self).__init__(self.describe())

    def describe(self):
        head = []
        if self.chart_id:
            head.append("chart '%s'" % self.chart_id)
        if self.chart_type:
            head.append("type=%s" % self.chart_type)
        prefix = " ".join(head)
        return "%s: %s" % (prefix, self.message) if prefix else self.message


class SpecError(Exception):
    """整份 spec 的错误集合。"""

    def __init__(self, errors):
        self.errors = list(errors)
        super(SpecError, self).__init__("; ".join(self.errors))


def _fail(cid, ctype, message):
    raise ChartError(cid, ctype, message)


def _setup():
    """初始化 matplotlib（中文字体、负号、白底）。幂等。"""
    global plt
    if plt is None:
        plt = palette.setup_matplotlib()
    return plt


def _clamp(value, low, high):
    return max(low, min(high, value))


def _tick_text(value):
    """坐标轴刻度：千分位、按量级收小数，避免出现 1.2e+03。"""
    num = float(value)
    if num == 0:
        return "0"
    mag = abs(num)
    if mag >= 1000:
        return "{:,.0f}".format(num)
    if mag >= 10:
        return "{:.2f}".format(num).rstrip("0").rstrip(".")
    if mag >= 1:
        return "{:.3f}".format(num).rstrip("0").rstrip(".")
    return "{:.4g}".format(num)


def _value_text(value, fmt=None):
    """数值标签：优先用 spec 的 value_fmt，否则千分位去掉多余零。"""
    if fmt:
        return fmt.format(value)
    text = "{:,.2f}".format(float(value))
    text = text.rstrip("0").rstrip(".")
    return "0" if text in ("", "-0", "-") else text


def _label_fmt(values):
    """一组数值标签的默认格式：全整数用千分位整数，含小数则统一保留一位。"""
    numbers = [float(value) for value in values]
    if not numbers:
        return "{:,.0f}"
    if all(abs(num - round(num)) < 1e-9 for num in numbers):
        return "{:,.0f}"
    return "{:,.1f}"


def _text_width_in(texts, fontsize=8.2):
    """粗估一组标签的最宽像素（inch），用于给 barh/heatmap 预留左边距。"""
    width = 0.0
    for item in texts:
        line = 0.0
        for char in str(item):
            line += 0.118 if ord(char) > 127 else 0.058
        width = max(width, line * fontsize / 8.5)
    return width


# ---------------------------------------------------------------------------
# 校验：把原始 spec 归一化成绘图配置
# ---------------------------------------------------------------------------

def _opt_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value, cid, ctype, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(cid, ctype, "字段 %s 必须是数字，实际为 %r" % (field, value))
    num = float(value)
    if not math.isfinite(num):
        _fail(cid, ctype, "字段 %s 含 NaN/Inf，无法绘制" % field)
    return num


def _opt_number(raw, key, cid, ctype):
    if key not in raw or raw[key] is None:
        return None
    return _number(raw[key], cid, ctype, key)


def _number_list(values, cid, ctype, field, expect_len=None):
    if not isinstance(values, (list, tuple)):
        _fail(cid, ctype, "字段 %s 必须是数组" % field)
    if expect_len is not None and len(values) != expect_len:
        _fail(cid, ctype, "字段 %s 长度为 %d，与 x 轴的 %d 个分类不一致"
              % (field, len(values), expect_len))
    out = []
    for index, item in enumerate(values):
        out.append(_number(item, cid, ctype, "%s[%d]" % (field, index)))
    return out


def _require(raw, key, cid, ctype):
    if key not in raw or raw[key] is None:
        _fail(cid, ctype, "缺少必填字段 %s" % key)
    return raw[key]


def _label_list(values, cid, ctype, field):
    if not isinstance(values, (list, tuple)) or len(values) == 0:
        _fail(cid, ctype, "字段 %s 必须是非空数组" % field)
    out = []
    for index, item in enumerate(values):
        if isinstance(item, (list, dict)) or item is None:
            _fail(cid, ctype, "字段 %s[%d] 必须是标量文字" % (field, index))
        out.append(str(item))
    return out


def _series_list(raw, cid, ctype, n=None, need_kind=False):
    items = _require(raw, "series", cid, ctype)
    if not isinstance(items, list) or not items:
        _fail(cid, ctype, "字段 series 必须是非空数组")
    out = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            _fail(cid, ctype, "series[%d] 必须是对象" % index)
        name = _opt_text(item.get("name")) or ("序列%d" % (index + 1))
        if "values" not in item:
            _fail(cid, ctype, "series[%d] 缺少 values" % index)
        values = _number_list(item["values"], cid, ctype,
                              "series[%d].values" % index, expect_len=n)
        entry = {
            "name": name,
            "values": values,
            "color": palette.color(item.get("color") or palette.series_color(index)),
        }
        if need_kind:
            kind = str(item.get("kind") or "line").lower()
            if kind not in ("line", "bar"):
                _fail(cid, ctype, "series[%d].kind=%r 只支持 bar / line" % (index, kind))
            axis = str(item.get("axis") or "left").lower()
            if axis not in ("left", "right"):
                _fail(cid, ctype, "series[%d].axis=%r 只支持 left / right" % (index, axis))
            entry["kind"] = kind
            entry["axis"] = axis
        out.append(entry)
    return out


def _points_list(raw, cid, ctype, need_size=False):
    points = _require(raw, "points", cid, ctype)
    if not isinstance(points, list) or not points:
        _fail(cid, ctype, "字段 points 必须是非空数组")
    out = []
    for index, item in enumerate(points):
        if not isinstance(item, dict):
            _fail(cid, ctype, "points[%d] 必须是对象" % index)
        if "x" not in item or "y" not in item:
            _fail(cid, ctype, "points[%d] 缺少 x 或 y" % index)
        point = {
            "x": _number(item["x"], cid, ctype, "points[%d].x" % index),
            "y": _number(item["y"], cid, ctype, "points[%d].y" % index),
            "label": _opt_text(item.get("label")),
        }
        if need_size:
            if "size" not in item:
                _fail(cid, ctype, "points[%d] 缺少 size（气泡大小）" % index)
            size = _number(item["size"], cid, ctype, "points[%d].size" % index)
            if size < 0:
                _fail(cid, ctype, "points[%d].size 不能为负" % index)
            point["size"] = size
        out.append(point)
    return out


def _x_axis(raw, cid, ctype):
    """返回 (labels, positions, numeric)。数字型 x 用真实坐标，其他按分类等距。"""
    values = _require(raw, "x", cid, ctype)
    if not isinstance(values, (list, tuple)) or not values:
        _fail(cid, ctype, "字段 x 必须是非空数组")
    numeric = True
    for index, item in enumerate(values):
        if isinstance(item, bool) or item is None or isinstance(item, (list, dict)):
            _fail(cid, ctype, "字段 x[%d] 必须是标量" % index)
        if not isinstance(item, (int, float)):
            numeric = False
        elif not math.isfinite(float(item)):
            _fail(cid, ctype, "字段 x[%d] 含 NaN/Inf" % index)
    if numeric:
        positions = [float(item) for item in values]
        labels = [_tick_text(item) for item in values]
    else:
        positions = [float(index) for index in range(len(values))]
        labels = [str(item) for item in values]
    return labels, positions, numeric


def _figsize(raw, base_width, default_height, cid, ctype):
    width, height = float(base_width), float(default_height)
    size = raw.get("size")
    if size is not None:
        if isinstance(size, dict):
            if "width" in size:
                width = _number(size["width"], cid, ctype, "size.width")
            if "height" in size:
                height = _number(size["height"], cid, ctype, "size.height")
        elif isinstance(size, (list, tuple)):
            if len(size) != 2:
                _fail(cid, ctype, "size 数组必须是 [宽, 高]")
            width = _number(size[0], cid, ctype, "size[0]")
            height = _number(size[1], cid, ctype, "size[1]")
        elif isinstance(size, (int, float)) and not isinstance(size, bool):
            width = _number(size, cid, ctype, "size")
        else:
            _fail(cid, ctype, "size 必须是 [宽, 高] / {\"width\",\"height\"} / 数字宽度")
    if width <= 1.0 or height <= 1.0:
        _fail(cid, ctype, "图幅过小（宽 %.2f in × 高 %.2f in），至少 1 inch" % (width, height))
    if width > 20.0 or height > 20.0:
        _fail(cid, ctype, "图幅过大（宽 %.2f in × 高 %.2f in），上限 20 inch" % (width, height))
    return (width, height)


def _default_height(ctype, raw):
    if ctype == "barh":
        count = len(raw.get("labels") or []) or len(raw.get("values") or []) or 1
        return _clamp(1.30 + 0.34 * count, 2.70, 5.60)
    if ctype == "heatmap":
        matrix = raw.get("matrix")
        rows = len(matrix) if isinstance(matrix, list) else 0
        return _clamp(1.30 + 0.40 * max(rows, 1), 3.10, 5.40)
    if ctype == "waterfall":
        steps = raw.get("steps")
        count = len(steps) if isinstance(steps, list) else 0
        return _clamp(1.95 + 0.30 * max(count, 1), 3.20, 4.80)
    return DEFAULT_HEIGHT.get(ctype, 3.50)


def _warn(warnings, cid, message):
    text = "chart '%s': %s" % (cid, message)
    if text not in warnings:
        warnings.append(text)


def _normalize_chart(raw, index, base_width, warnings):
    if not isinstance(raw, dict):
        _fail("charts[%d]" % index, None, "图表必须是 JSON 对象")

    cid = raw.get("id")
    ctype = raw.get("type")
    if not isinstance(cid, str) or not cid.strip():
        _fail("charts[%d]" % index, ctype, "缺少字符串字段 id")
    cid = cid.strip()
    if ctype not in TYPES:
        _fail(cid, ctype, "不支持的 type %r；可选：%s" % (ctype, " / ".join(TYPES)))

    cfg = {"id": cid, "type": ctype, "index": index}
    cfg["title"] = _opt_text(raw.get("title"))
    cfg["subtitle"] = _opt_text(raw.get("subtitle"))
    cfg["footnote"] = _opt_text(raw.get("footnote"))
    cfg["x_label"] = _opt_text(raw.get("x_label"))
    cfg["y_label"] = _opt_text(raw.get("y_label"))
    cfg["legend"] = bool(raw.get("legend", True))
    cfg["grid"] = bool(raw.get("grid", True))
    cfg["value_fmt"] = raw.get("value_fmt")
    cfg["tick_fmt"] = raw.get("tick_fmt")
    cfg["legend_ncol"] = raw.get("legend_ncol")
    cfg["highlight"] = _opt_text(raw.get("highlight"))
    cfg["annotate"] = raw.get("annotate") or []
    cfg["reverse"] = bool(raw.get("reverse", False))
    cfg["center"] = _opt_text(raw.get("center"))
    cfg["color"] = palette.color(raw.get("color")) if raw.get("color") else None
    cfg["y_min"] = _opt_number(raw, "y_min", cid, ctype)
    cfg["y_max"] = _opt_number(raw, "y_max", cid, ctype)
    cfg["y_label_right"] = _opt_text(raw.get("y_label_right"))
    cfg["y_min_right"] = _opt_number(raw, "y_min_right", cid, ctype)
    cfg["y_max_right"] = _opt_number(raw, "y_max_right", cid, ctype)

    if cfg["y_min"] is not None and cfg["y_max"] is not None and cfg["y_min"] >= cfg["y_max"]:
        _fail(cid, ctype, "y_min(%s) 必须小于 y_max(%s)" % (cfg["y_min"], cfg["y_max"]))

    fmt = cfg["value_fmt"]
    if fmt is not None:
        if not isinstance(fmt, str):
            _fail(cid, ctype, "value_fmt 必须是字符串")
        try:
            fmt.format(1.234)
        except Exception as exc:
            _fail(cid, ctype, "value_fmt=%r 无法格式化数字（%s）" % (fmt, exc))

    for key in ("tick_fmt",):
        text = cfg[key]
        if text is None:
            continue
        if not isinstance(text, str):
            _fail(cid, ctype, "%s 必须是字符串" % key)
        try:
            text.format(1.234)
        except Exception as exc:
            _fail(cid, ctype, "%s=%r 无法格式化数字（%s）" % (key, text, exc))

    if cfg["annotate"] is not None and not isinstance(cfg["annotate"], list):
        _fail(cid, ctype, "annotate 必须是数组")
    for pos, item in enumerate(cfg["annotate"]):
        if not isinstance(item, dict) or _opt_text(item.get("text")) is None:
            _fail(cid, ctype, "annotate[%d] 必须是含 text 的对象" % pos)
        if "x" not in item or "y" not in item:
            _fail(cid, ctype, "annotate[%d] 缺少 x 或 y" % pos)

    cfg["figsize"] = _figsize(raw, base_width, _default_height(ctype, raw), cid, ctype)

    if not cfg["title"]:
        _warn(warnings, cid, "缺少 title，图上不会有标题")
    if not cfg["footnote"]:
        _warn(warnings, cid, "缺少 footnote（来源脚注）")

    cfg["value_labels"] = raw.get("value_labels")
    cfg["highlight_type"] = None   # "x" 或 "series"
    cfg["highlight_pos"] = None
    cfg["highlight_series"] = None

    if ctype == "line" or ctype == "area":
        labels, positions, numeric = _x_axis(raw, cid, ctype)
        cfg["xlabels"] = labels
        cfg["xpos"] = positions
        cfg["numeric_x"] = numeric
        cfg["series"] = _series_list(raw, cid, ctype, n=len(labels))
        if cfg["value_labels"] is None:
            cfg["value_labels"] = False

    elif ctype == "bar" or ctype == "grouped_bar" or ctype == "stacked_bar":
        labels, positions, numeric = _x_axis(raw, cid, ctype)
        cfg["xlabels"] = labels
        cfg["xpos"] = positions
        cfg["numeric_x"] = numeric
        cfg["series"] = _series_list(raw, cid, ctype, n=len(labels))
        stacked = bool(raw.get("stacked", False)) or ctype == "stacked_bar"
        cfg["stacked"] = stacked
        series_count = len(cfg["series"])
        if cfg["value_labels"] is None:
            cfg["value_labels"] = (series_count == 1) and len(labels) <= 14

    elif ctype == "combo":
        labels, positions, numeric = _x_axis(raw, cid, ctype)
        cfg["xlabels"] = labels
        cfg["xpos"] = positions
        cfg["numeric_x"] = numeric
        cfg["series"] = _series_list(raw, cid, ctype, n=len(labels), need_kind=True)
        bar_count = sum(1 for item in cfg["series"] if item["kind"] == "bar")
        if cfg["value_labels"] is None:
            cfg["value_labels"] = (bar_count == 1) and len(labels) <= 12
        if not any(item["kind"] == "bar" for item in cfg["series"]) and \
                not any(item["kind"] == "line" for item in cfg["series"]):
            _fail(cid, ctype, "combo 至少需要一条柱序列或折线序列")

    elif ctype == "barh":
        if "labels" in raw and raw.get("labels") is not None:
            cfg["labels"] = _label_list(raw["labels"], cid, ctype, "labels")
            cfg["values"] = _number_list(_require(raw, "values", cid, ctype),
                                         cid, ctype, "values", expect_len=len(cfg["labels"]))
        elif "series" in raw:
            series = _series_list(raw, cid, ctype)
            if len(series) > 1:
                _fail(cid, ctype, "barh 只支持单序列，请用 labels + values")
            if "labels" not in raw or raw.get("labels") is None:
                _fail(cid, ctype, "barh 需要 labels（分类名）")
            cfg["labels"] = _label_list(raw["labels"], cid, ctype, "labels")
            cfg["values"] = series[0]["values"]
            if len(cfg["values"]) != len(cfg["labels"]):
                _fail(cid, ctype, "series[0].values 长度与 labels 不一致")
            if not cfg["color"]:
                cfg["color"] = series[0]["color"]
        else:
            _fail(cid, ctype, "缺少必填字段 labels / values")
        if cfg["value_labels"] is None:
            cfg["value_labels"] = True

    elif ctype == "scatter":
        cfg["points"] = _points_list(raw, cid, ctype)
        if cfg["value_labels"] is None:
            cfg["value_labels"] = False

    elif ctype == "bubble":
        cfg["points"] = _points_list(raw, cid, ctype, need_size=True)
        if all(point["size"] <= 0 for point in cfg["points"]):
            _fail(cid, ctype, "points[].size 全为 0，无法确定气泡大小")
        if cfg["value_labels"] is None:
            cfg["value_labels"] = False

    elif ctype == "heatmap":
        matrix = _require(raw, "matrix", cid, ctype)
        if not isinstance(matrix, list) or not matrix:
            _fail(cid, ctype, "字段 matrix 必须是非空二维数组")
        rows = []
        width = None
        for r_index, row in enumerate(matrix):
            if not isinstance(row, (list, tuple)) or not row:
                _fail(cid, ctype, "matrix[%d] 必须是非空数组" % r_index)
            width = len(row) if width is None else width
            if len(row) != width:
                _fail(cid, ctype, "matrix 第 %d 行长度 %d 与首行 %d 不一致"
                      % (r_index, len(row), width))
            rows.append(_number_list(row, cid, ctype, "matrix[%d]" % r_index,
                                     expect_len=width))
        cfg["matrix"] = rows
        cfg["row_labels"] = _label_list(_require(raw, "row_labels", cid, ctype),
                                        cid, ctype, "row_labels")
        cfg["col_labels"] = _label_list(_require(raw, "col_labels", cid, ctype),
                                        cid, ctype, "col_labels")
        if len(cfg["row_labels"]) != len(rows):
            _fail(cid, ctype, "row_labels 有 %d 个，matrix 有 %d 行"
                  % (len(cfg["row_labels"]), len(rows)))
        if len(cfg["col_labels"]) != width:
            _fail(cid, ctype, "col_labels 有 %d 个，matrix 每行 %d 列"
                  % (len(cfg["col_labels"]), width))
        cfg["cmap"] = raw.get("cmap")
        cfg["highlight_cell"] = None
        cell = raw.get("highlight_cell")
        if cell is not None:
            if (not isinstance(cell, (list, tuple)) or len(cell) != 2
                    or not all(isinstance(v, int) and not isinstance(v, bool) for v in cell)):
                _fail(cid, ctype, "highlight_cell 必须是 [行, 列] 两个整数")
            r_index, c_index = int(cell[0]), int(cell[1])
            if not (0 <= r_index < len(rows)) or not (0 <= c_index < width):
                _fail(cid, ctype, "highlight_cell %r 超出 %d×%d 矩阵范围"
                      % (list(cell), len(rows), width))
            cfg["highlight_cell"] = (r_index, c_index)
        if cfg["value_labels"] is None:
            cfg["value_labels"] = True

    elif ctype == "waterfall":
        steps = _require(raw, "steps", cid, ctype)
        if not isinstance(steps, list) or not steps:
            _fail(cid, ctype, "字段 steps 必须是非空数组")
        parsed = []
        for index_step, item in enumerate(steps):
            if not isinstance(item, dict):
                _fail(cid, ctype, "steps[%d] 必须是对象" % index_step)
            label = _opt_text(item.get("label")) or ("第%d步" % (index_step + 1))
            if "value" not in item:
                _fail(cid, ctype, "steps[%d] 缺少 value" % index_step)
            value = _number(item["value"], cid, ctype, "steps[%d].value" % index_step)
            kind = str(item.get("kind") or "delta").lower()
            if kind not in ("delta", "total"):
                _fail(cid, ctype, "steps[%d].kind=%r 只支持 delta / total" % (index_step, kind))
            parsed.append({"label": label, "value": value, "kind": kind})
        cfg["steps"] = parsed
        if cfg["value_labels"] is None:
            cfg["value_labels"] = True

    elif ctype == "donut":
        cfg["labels"] = _label_list(_require(raw, "labels", cid, ctype),
                                    cid, ctype, "labels")
        cfg["values"] = _number_list(_require(raw, "values", cid, ctype),
                                     cid, ctype, "values", expect_len=len(cfg["labels"]))
        if any(value < 0 for value in cfg["values"]):
            _fail(cid, ctype, "donut 只支持非负值")
        if sum(cfg["values"]) <= 0:
            _fail(cid, ctype, "donut 数值合计必须大于 0")
        if cfg["value_labels"] is None:
            cfg["value_labels"] = True

    # ---- 未采用的字段给出提示，避免规格写了却没生效 ----
    if ctype != "barh" and cfg["reverse"]:
        _warn(warnings, cid, "reverse 仅对 barh 生效，已忽略")
    if ctype in ("heatmap", "donut", "waterfall", "barh") and cfg["annotate"]:
        _warn(warnings, cid, "%s 不支持 annotate，已忽略" % ctype)
    if ctype in ("donut", "heatmap", "barh") and cfg["y_label"]:
        _warn(warnings, cid, "%s 不使用 y_label，已忽略" % ctype)
    if ctype in ("donut", "heatmap") and cfg["x_label"]:
        _warn(warnings, cid, "%s 不使用 x_label，已忽略" % ctype)
    if ctype == "waterfall" and cfg["x_label"]:
        _warn(warnings, cid, "waterfall 不使用 x_label，已忽略")
    if ctype in ("donut", "heatmap", "waterfall") and raw.get("value_labels") is not None:
        _warn(warnings, cid, "%s 固定显示数值，value_labels 已忽略" % ctype)
    if ctype in ("donut", "heatmap") and cfg["highlight"]:
        _warn(warnings, cid, "%s 不支持 highlight，已忽略" % ctype)

    cfg["numeric_x"] = cfg.get("numeric_x", False)
    return cfg


def _validate_spec(spec, args):
    if not isinstance(spec, dict):
        raise SpecError(["spec 顶层必须是 JSON 对象"])

    charts_raw = spec.get("charts")
    if not isinstance(charts_raw, list) or not charts_raw:
        raise SpecError(["spec.charts 必须是非空数组"])

    if args.width_in is not None:
        width_in = args.width_in
    else:
        width_in = spec.get("width_in", palette.CHART_WIDTH_IN)
    if isinstance(width_in, bool) or not isinstance(width_in, (int, float)) \
            or not math.isfinite(float(width_in)):
        raise SpecError(["width_in 必须是数字"])
    width_in = float(width_in)
    if not (1.0 < width_in <= 20.0):
        raise SpecError(["width_in=%s 超出合理范围（1–20 inch）" % width_in])

    if args.dpi is not None:
        dpi = args.dpi
    else:
        dpi = spec.get("dpi", palette.CHART_DPI)
    if isinstance(dpi, bool) or not isinstance(dpi, int):
        raise SpecError(["dpi 必须是整数"])
    if not (20 <= dpi <= 1200):
        raise SpecError(["dpi=%s 超出合理范围（20–1200）" % dpi])

    errors = []
    warnings = []
    charts = []
    used_names = {}
    for index, raw in enumerate(charts_raw):
        try:
            cfg = _normalize_chart(raw, index, width_in, warnings)
        except ChartError as exc:
            errors.append(exc.describe())
            continue
        filename = _safe_filename(cfg["id"])
        if filename in used_names:
            errors.append("chart '%s': id 与 chart '%s' 规范化后文件名相同（%s）"
                          % (cfg["id"], used_names[filename], filename))
            continue
        used_names[filename] = cfg["id"]
        cfg["filename"] = filename
        charts.append(cfg)

    if errors:
        raise SpecError(errors)
    return width_in, dpi, charts, warnings


_SAFE_NAME = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._-]+")


def _safe_filename(chart_id):
    name = _SAFE_NAME.sub("_", chart_id).strip("._")
    return (name or "chart") + ".png"


# ---------------------------------------------------------------------------
# 版式工具
# ---------------------------------------------------------------------------

def _frame(cfg, left_in=0.62, right_in=0.18, top_extra_in=0.0,
           legend_in=0.0, bottom_extra_in=0.0):
    """建图并留出标题/副标题/图例/脚注的位置，返回 (fig, ax)。

    所有边距按英寸换算成 figure 比例，保证不同高度图型上文字间距一致。
    """
    width, height = cfg["figsize"]
    fig = plt.figure(figsize=(width, height))

    top_in = 0.07
    if cfg["title"]:
        top_in += 0.30
    if cfg["subtitle"]:
        top_in += 0.21
    top_in += legend_in + top_extra_in

    bottom_in = 0.07 + 0.18          # 脚注 + x 刻度
    if cfg["x_label"]:
        bottom_in += 0.24
    bottom_in += bottom_extra_in

    left = _clamp(left_in / width, 0.02, 0.42)
    right = 1.0 - _clamp(right_in / width, 0.02, 0.40)
    top = 1.0 - _clamp(top_in / height, 0.02, 0.62)
    bottom = _clamp(bottom_in / height, 0.02, 0.46)
    if top - bottom < 0.15:          # 图幅被压得太扁时优先保住绘图区
        bottom = max(0.04, top - 0.30)

    ax = fig.add_axes([left, bottom, max(0.10, right - left), max(0.10, top - bottom)])

    if cfg["title"]:
        fig.text(0.0, 1.0 - 0.06 / height, cfg["title"], ha="left", va="top",
                 fontsize=11, fontweight="bold", color=INK)
    if cfg["subtitle"]:
        offset = 0.06 + (0.29 if cfg["title"] else 0.02)
        fig.text(0.0, 1.0 - offset / height, cfg["subtitle"], ha="left", va="top",
                 fontsize=8.6, color=GREY)
    if cfg["footnote"]:
        note = fig.text(0.0, 0.055 / height, cfg["footnote"], ha="left", va="bottom",
                        fontsize=7.6, color=GREY)
    else:
        note = None
    # 记下脚注与主坐标轴，绘制完成后再统一校正脚注位置（见 _finalize_note）
    fig._dsh_note = note
    fig._dsh_axes = [ax]
    return fig, ax


def _finalize_note(fig):
    """把来源脚注挪到所有 x 轴文字下方，避免和刻度标签、轴标题叠在一起。

    bbox_inches="tight" 会连同画布外的文字一起裁进图片，所以脚注可以放到
    figure 坐标系之外，不必为它在图内预留固定高度。
    """
    note = getattr(fig, "_dsh_note", None)
    if note is None:
        return
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    height_in = fig.get_size_inches()[1]
    inverse = fig.transFigure.inverted()
    lowest = None
    for ax in getattr(fig, "_dsh_axes", []):
        box = ax.get_tightbbox(renderer)
        if box is None:
            continue
        edge = box.transformed(inverse).y0 * height_in
        lowest = edge if lowest is None else min(lowest, edge)
    if lowest is None:
        return
    note.set_verticalalignment("top")
    note.set_position((0.0, (lowest - 0.06) / height_in))


def _style_axes(ax, cfg, grid_axis="y", value_axis="y", y_formatter=True):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GREY)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(axis="both", labelsize=8, length=2.6, width=0.7, colors=INK)
    if cfg["grid"] and grid_axis != "none":
        ax.set_axisbelow(True)
        ax.grid(True, axis=grid_axis, color=GRID, linewidth=0.7)
    if y_formatter:
        tick_fmt = cfg["tick_fmt"]
        if tick_fmt:
            formatter = FuncFormatter(lambda value, _pos: tick_fmt.format(value))
        else:
            formatter = FuncFormatter(lambda value, _pos: _tick_text(value))
        if value_axis == "x":
            ax.xaxis.set_major_formatter(formatter)
        else:
            ax.yaxis.set_major_formatter(formatter)
    if cfg["y_label"] and cfg["type"] != "barh":
        ax.set_ylabel(str(cfg["y_label"]), fontsize=8.4, color=INK, labelpad=5)
    if cfg["x_label"] and cfg["type"] != "barh":
        ax.set_xlabel(str(cfg["x_label"]), fontsize=8.4, color=INK, labelpad=5)


def _legend_plan(count, override=None):
    """返回 (列数, 预留高度 inch)。图例放在绘图区正上方，横向排。"""
    if count <= 0:
        return 0, 0.0
    ncol = override if isinstance(override, int) and override > 0 else min(count, 4)
    ncol = max(1, min(ncol, count))
    rows = int(math.ceil(count / float(ncol)))
    return ncol, 0.21 * rows + 0.04


def _legend_above(ax, handles, labels, ncol):
    if not handles:
        return None
    legend = ax.legend(handles, labels, loc="lower left", bbox_to_anchor=(0.0, 1.01),
                       ncol=ncol, frameon=False, fontsize=8.0, handlelength=1.6,
                       handletextpad=0.5, columnspacing=1.5, borderaxespad=0.0,
                       borderpad=0.0)
    for text in legend.get_texts():
        text.set_color(INK)
    return legend


def _categorical_xticks(ax, labels, positions, available_in, fontsize=8.0):
    ax.set_xticks(list(positions))
    ax.set_xticklabels(labels, fontsize=fontsize)
    if not labels:
        return
    need = _text_width_in(labels, fontsize) * len(labels) + 0.06 * len(labels)
    if need > available_in * 0.98:
        for text in ax.get_xticklabels():
            text.set_rotation(28)
            text.set_ha("right")
            text.set_rotation_mode("anchor")


def _slot_width(cfg):
    """柱宽：分类 x 用 1 单位，数字 x 取最小间距。"""
    positions = cfg["xpos"]
    if len(positions) < 2:
        return 0.62
    gaps = [positions[i + 1] - positions[i] for i in range(len(positions) - 1)]
    positive = [gap for gap in gaps if gap > 0]
    if not positive:
        return 0.62
    return min(positive) * 0.72


def _apply_limits(axis_obj, cfg, lo_key="y_min", hi_key="y_max"):
    low, high = cfg[lo_key], cfg[hi_key]
    if low is not None or high is not None:
        axis_obj.set_ylim(low, high)


def _highlight_target(cfg):
    """解析 highlight：先按 x 取值匹配，再按序列名匹配。"""
    highlight = cfg.get("highlight")
    if not highlight:
        return None, None
    labels = cfg.get("xlabels") or []
    if highlight in labels:
        index = labels.index(highlight)
        return cfg["xpos"][index], None
    if not cfg.get("numeric_x"):
        for series_index, series in enumerate(cfg.get("series") or []):
            if series["name"] == highlight:
                return None, series_index
    else:
        for series_index, series in enumerate(cfg.get("series") or []):
            if series["name"] == highlight:
                return None, series_index
    return None, None


def _resolve_x(value, cfg, cid=None, ctype=None):
    labels = cfg.get("xlabels") or []
    if isinstance(value, str):
        if value in labels:
            return cfg["xpos"][labels.index(value)]
        _fail(cid or cfg["id"], ctype or cfg["type"],
              "annotate.x=%r 不在 x 轴取值中（%s）" % (value, " / ".join(labels[:8])))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(cid or cfg["id"], ctype or cfg["type"],
              "annotate.x 必须是 x 轴取值或分类名，实际为 %r" % (value,))
    number = float(value)
    if not math.isfinite(number):
        _fail(cid or cfg["id"], ctype or cfg["type"], "annotate.x 含 NaN/Inf")
    if cfg["numeric_x"]:
        return number
    index = int(round(number))
    if 0 <= index < len(labels):
        return cfg["xpos"][index]
    _fail(cid or cfg["id"], ctype or cfg["type"],
          "annotate.x=%r 超出分类范围（共 %d 项）" % (value, len(labels)))


def _annotate_points(ax, cfg, second_ax=None):
    """按 spec 的 annotate 在图上标文字（带一根细引导线）。"""
    for item in cfg.get("annotate") or []:
        target = second_ax if (second_ax is not None
                               and str(item.get("axis") or "left").lower() == "right") else ax
        xpos = _resolve_x(item["x"], cfg)
        ypos = _number(item["y"], cfg["id"], cfg["type"], "annotate.y")
        color = palette.color(item.get("color") or "INK")
        dx = float(item.get("dx", 0) or 0)
        dy = float(item.get("dy", 13) or 13)
        target.annotate(str(item["text"]), xy=(xpos, ypos), xytext=(dx, dy),
                        textcoords="offset points", ha="center", va="bottom",
                        fontsize=7.6, color=color, annotation_clip=False,
                        arrowprops=dict(arrowstyle="-", color=GREY, linewidth=0.6,
                                        shrinkA=2, shrinkB=3))


def _value_labels_bar(ax, positions, tops, values, fmt, fontsize=7.4, backdrop=False):
    """柱顶数值标签；负值标在柱底。

    backdrop=True 时给文字加一层白底，避免被折线或网格线穿过（combo 用）。
    """
    bbox = dict(facecolor="white", edgecolor="none", boxstyle="square,pad=0.10") \
        if backdrop else None
    for xpos, ypos, value in zip(positions, tops, values):
        if value >= 0:
            ax.annotate(_value_text(value, fmt), xy=(xpos, ypos), xytext=(0, 2),
                        textcoords="offset points", ha="center", va="bottom",
                        fontsize=fontsize, color=INK, bbox=bbox)
        else:
            ax.annotate(_value_text(value, fmt), xy=(xpos, ypos), xytext=(0, -2),
                        textcoords="offset points", ha="center", va="top",
                        fontsize=fontsize, color=INK, bbox=bbox)


def _bar_span_for_highlight(ax, cfg):
    """柱图高亮某个 x：在对应分类后加一条淡色竖带。"""
    highlight = cfg.get("highlight")
    if not highlight:
        return
    labels = cfg["xlabels"]
    if highlight not in labels:
        return
    index = labels.index(highlight)
    xpos = cfg["xpos"][index]
    half = _slot_width(cfg) / 2.0 + 0.08
    ax.axvspan(xpos - half, xpos + half, color=AMBER, alpha=0.10, zorder=0, linewidth=0)


# ---------------------------------------------------------------------------
# 各图型渲染
# ---------------------------------------------------------------------------

def _render_line(cfg):
    series = cfg["series"]
    ncol, legend_in = _legend_plan(len(series), cfg["legend_ncol"]) if cfg["legend"] else (0, 0.0)
    fig, ax = _frame(cfg, legend_in=legend_in)
    _style_axes(ax, cfg)

    xs = cfg["xpos"]
    highlight_x, highlight_series = _highlight_target(cfg)
    for index, item in enumerate(series):
        wide = 2.2
        alpha = 1.0
        if highlight_series is not None:
            if index == highlight_series:
                wide = 2.7
            else:
                wide, alpha = 1.5, 0.55
        ax.plot(xs, item["values"], color=item["color"], linewidth=wide, alpha=alpha,
                marker="o", markersize=3.4, markerfacecolor="white",
                markeredgecolor=item["color"], markeredgewidth=1.0, zorder=3,
                label=item["name"], solid_capstyle="round")

    if highlight_x is not None:
        ax.axvline(highlight_x, color=AMBER, linewidth=0.9, linestyle=(0, (4, 3)), zorder=2)

    if cfg["value_labels"]:
        fmt = cfg["value_fmt"] or _label_fmt(
            [value for item in series for value in item["values"]])
        for item in series:
            for xpos, value in zip(xs, item["values"]):
                ax.annotate(_value_text(value, fmt), xy=(xpos, value),
                            xytext=(0, 5), textcoords="offset points", ha="center",
                            va="bottom", fontsize=7.0, color=GREY)

    if not cfg["numeric_x"]:
        available = cfg["figsize"][0] * 0.80
        _categorical_xticks(ax, cfg["xlabels"], xs, available)
        count = len(xs)
        ax.set_xlim((-0.45, count - 0.55) if count > 1 else (-0.8, 0.8))
    _apply_limits(ax, cfg)
    _annotate_points(ax, cfg)

    if cfg["legend"] and ncol:
        handles, labels = ax.get_legend_handles_labels()
        _legend_above(ax, handles, labels, ncol)
    return fig


def _render_area(cfg):
    series = cfg["series"]
    ncol, legend_in = _legend_plan(len(series), cfg["legend_ncol"]) if cfg["legend"] else (0, 0.0)
    fig, ax = _frame(cfg, legend_in=legend_in)
    _style_axes(ax, cfg)

    xs = cfg["xpos"]
    for index, item in enumerate(series):
        if any(value < 0 for value in item["values"]):
            _warn(cfg["warnings"], cfg["id"], "area 含负值，堆叠面积可能出现重叠")
            break

    stacks = ax.stackplot(xs, [item["values"] for item in series],
                          colors=[item["color"] for item in series],
                          labels=[item["name"] for item in series],
                          alpha=0.92, edgecolor="white", linewidth=0.7, zorder=3)
    if cfg["y_min"] is None:
        ax.set_ylim(bottom=0)

    highlight_x, _ = _highlight_target(cfg)
    if highlight_x is not None:
        ax.axvline(highlight_x, color=INK, linewidth=0.9, linestyle=(0, (4, 3)),
                   alpha=0.55, zorder=4)

    if not cfg["numeric_x"]:
        available = cfg["figsize"][0] * 0.80
        _categorical_xticks(ax, cfg["xlabels"], xs, available)
        count = len(xs)
        ax.set_xlim((-0.45, count - 0.55) if count > 1 else (-0.8, 0.8))
    _apply_limits(ax, cfg)

    if cfg["legend"] and ncol:
        _legend_above(ax, list(reversed(stacks)),
                      list(reversed([item["name"] for item in series])), ncol)
    return fig


def _render_bar(cfg):
    series = cfg["series"]
    stacked = bool(cfg.get("stacked"))
    fmt = cfg["value_fmt"] or _label_fmt(
        [value for item in series for value in item["values"]])
    ncol, legend_in = _legend_plan(len(series), cfg["legend_ncol"]) if cfg["legend"] else (0, 0.0)
    fig, ax = _frame(cfg, legend_in=legend_in)
    _style_axes(ax, cfg)

    xs = cfg["xpos"]
    slot = _slot_width(cfg)
    _, highlight_series = _highlight_target(cfg)
    _bar_span_for_highlight(ax, cfg)

    if stacked:
        bottoms = [0.0] * len(xs)
        for index, item in enumerate(series):
            alpha = 0.55 if (highlight_series is not None and index != highlight_series) else 1.0
            ax.bar(xs, item["values"], bottom=bottoms, width=slot, color=item["color"],
                   edgecolor="white", linewidth=0.7, alpha=alpha, zorder=3,
                   label=item["name"])
            bottoms = [base + value for base, value in zip(bottoms, item["values"])]
        if cfg["value_labels"]:
            for xpos, total in zip(xs, bottoms):
                ax.annotate(_value_text(total, fmt), xy=(xpos, total), xytext=(0, 2),
                            textcoords="offset points", ha="center", va="bottom",
                            fontsize=7.2, color=INK)
    else:
        count = len(series)
        bar_width = slot / count
        for index, item in enumerate(series):
            offset = (index - (count - 1) / 2.0) * bar_width
            alpha = 0.55 if (highlight_series is not None and index != highlight_series) else 1.0
            positions = [xpos + offset for xpos in xs]
            ax.bar(positions, item["values"], width=bar_width * 0.92, color=item["color"],
                   edgecolor="white", linewidth=0.5, alpha=alpha, zorder=3,
                   label=item["name"])
            if cfg["value_labels"]:
                tops = [value for value in item["values"]]
                _value_labels_bar(ax, positions, tops, item["values"], fmt,
                                  fontsize=7.2 if count > 1 else 7.4)

    if all(value >= 0 for item in series for value in item["values"]) and \
            not stacked and cfg["y_min"] is None:
        ax.set_ylim(bottom=0)
    if not cfg["numeric_x"]:
        available = cfg["figsize"][0] * 0.80
        _categorical_xticks(ax, cfg["xlabels"], xs, available)
        count = len(xs)
        ax.set_xlim((-0.55, count - 0.45) if count > 1 else (-0.8, 0.8))
    _apply_limits(ax, cfg)
    _annotate_points(ax, cfg)

    if cfg["legend"] and ncol:
        handles, labels = ax.get_legend_handles_labels()
        _legend_above(ax, handles, labels, ncol)
    return fig


def _render_barh(cfg):
    labels = cfg["labels"]
    values = cfg["values"]
    count = len(labels)
    left_in = _clamp(0.30 + _text_width_in(labels) + 0.12, 0.62, 2.9)
    fig, ax = _frame(cfg, left_in=left_in, right_in=0.34 + 0.32)
    _style_axes(ax, cfg, grid_axis="x", value_axis="x", y_formatter=False)

    color = cfg["color"] or BLUE
    positions = list(range(count))
    ax.barh(positions, values, height=0.62, color=color, edgecolor="white",
            linewidth=0.5, zorder=3)
    ax.set_yticks(positions)
    ax.set_yticklabels(labels, fontsize=8.2, color=INK)
    # 默认第一项在最上方（排名习惯）；reverse=true 时第一项在最下方
    if cfg["reverse"]:
        ax.set_ylim(-0.6, count - 0.4)
    else:
        ax.set_ylim(count - 0.4, -0.6)

    if cfg["value_labels"]:
        fmt = cfg["value_fmt"] or _label_fmt(values)
        for ypos, value in zip(positions, values):
            if value >= 0:
                ax.annotate(_value_text(value, fmt), xy=(value, ypos),
                            xytext=(3.2, 0), textcoords="offset points",
                            ha="left", va="center", fontsize=7.4, color=INK)
            else:
                ax.annotate(_value_text(value, fmt), xy=(value, ypos),
                            xytext=(-3.2, 0), textcoords="offset points",
                            ha="right", va="center", fontsize=7.4, color=INK)

    if cfg["x_label"]:
        ax.set_xlabel(str(cfg["x_label"]), fontsize=8.4, color=INK, labelpad=5)
    _apply_limits(ax, cfg)
    return fig


def _render_combo(cfg):
    series = cfg["series"]
    need_right = any(item["axis"] == "right" for item in series)
    has_line = any(item["kind"] == "line" for item in series)
    fmt = cfg["value_fmt"] or _label_fmt(
        [value for item in series if item["kind"] == "bar" for value in item["values"]])
    ncol, legend_in = _legend_plan(len(series), cfg["legend_ncol"]) if cfg["legend"] else (0, 0.0)
    fig, ax = _frame(cfg, left_in=0.68, right_in=1.05 if need_right else 0.20,
                     legend_in=legend_in)
    _style_axes(ax, cfg)
    second = ax.twinx() if need_right else None
    if second is not None:
        for side in ("top", "left", "bottom"):
            second.spines[side].set_visible(False)
        second.spines["right"].set_color(GREY)
        second.spines["right"].set_linewidth(0.8)
        second.tick_params(axis="y", labelsize=8, length=2.6, width=0.7, colors=INK)
        tick_fmt = cfg["tick_fmt"]
        if tick_fmt:
            second.yaxis.set_major_formatter(FuncFormatter(lambda value, _p: tick_fmt.format(value)))
        else:
            second.yaxis.set_major_formatter(FuncFormatter(lambda value, _p: _tick_text(value)))
        if cfg["y_label_right"]:
            second.set_ylabel(str(cfg["y_label_right"]), fontsize=8.4, color=INK, labelpad=6)

    xs = cfg["xpos"]
    slot = _slot_width(cfg)
    _, highlight_series = _highlight_target(cfg)
    _bar_span_for_highlight(ax, cfg)

    for axis_key, axis_obj in (("left", ax), ("right", second)):
        if axis_obj is None:
            continue
        bars = [(i, item) for i, item in enumerate(series)
                if item["kind"] == "bar" and item["axis"] == axis_key]
        lines = [(i, item) for i, item in enumerate(series)
                 if item["kind"] == "line" and item["axis"] == axis_key]
        if bars:
            bar_width = slot / len(bars)
            for order, (index, item) in enumerate(bars):
                offset = (order - (len(bars) - 1) / 2.0) * bar_width
                alpha = 0.55 if (highlight_series is not None and index != highlight_series) else 1.0
                positions = [xpos + offset for xpos in xs]
                axis_obj.bar(positions, item["values"], width=bar_width * 0.9,
                             color=item["color"], edgecolor="white", linewidth=0.5,
                             alpha=alpha, zorder=3, label=item["name"])
                if cfg["value_labels"]:
                    _value_labels_bar(axis_obj, positions, item["values"],
                                      item["values"], fmt, fontsize=7.2,
                                      backdrop=has_line)
        for index, item in lines:
            wide = 2.7 if (highlight_series is not None and index == highlight_series) else 2.1
            axis_obj.plot(xs, item["values"], color=item["color"], linewidth=wide,
                          marker="o", markersize=3.6, markerfacecolor="white",
                          markeredgecolor=item["color"], markeredgewidth=1.1,
                          zorder=4, label=item["name"])

    if not cfg["numeric_x"]:
        available = cfg["figsize"][0] * 0.78
        _categorical_xticks(ax, cfg["xlabels"], xs, available)
        count = len(xs)
        ax.set_xlim((-0.55, count - 0.45) if count > 1 else (-0.8, 0.8))
    low, high = cfg["y_min"], cfg["y_max"]
    if low is not None or high is not None:
        ax.set_ylim(low, high)
    elif all(value >= 0 for index, item in enumerate(series)
             if item["kind"] == "bar" for value in item["values"]):
        ax.set_ylim(bottom=0)
    if second is not None:
        low_right, high_right = cfg["y_min_right"], cfg["y_max_right"]
        if low_right is not None or high_right is not None:
            second.set_ylim(low_right, high_right)
        elif all(value >= 0 for item in series if item["axis"] == "right" for value in item["values"]):
            second.set_ylim(bottom=0)
    _annotate_points(ax, cfg, second)

    if cfg["legend"] and ncol:
        handles, labels = ax.get_legend_handles_labels()
        if second is not None:
            extra_handles, extra_labels = second.get_legend_handles_labels()
            handles = list(handles) + list(extra_handles)
            labels = list(labels) + list(extra_labels)
        _legend_above(ax, handles, labels, ncol)
    return fig


def _render_scatter(cfg):
    points = cfg["points"]
    fig, ax = _frame(cfg, left_in=0.66, right_in=0.24)
    _style_axes(ax, cfg, grid_axis="both")

    highlight = cfg["highlight"]
    colors = []
    sizes = []
    for point in points:
        if highlight and point["label"] == highlight:
            colors.append(AMBER)
            sizes.append(86)
        else:
            colors.append(BLUE)
            sizes.append(44)
    ax.scatter([point["x"] for point in points], [point["y"] for point in points],
               s=sizes, c=colors, edgecolor="white", linewidth=0.8, alpha=0.9, zorder=3)

    for point in points:
        if not point["label"]:
            continue
        dy = 8 if not (highlight and point["label"] == highlight) else 10
        ax.annotate(point["label"], xy=(point["x"], point["y"]), xytext=(0, dy),
                    textcoords="offset points", ha="center", va="bottom",
                    fontsize=7.2, color=INK if point["label"] == highlight else GREY)

    _pad_point_limits(ax, cfg, [point["x"] for point in points],
                      [point["y"] for point in points], radius_pt=3.6, top_pt=10.0)
    _apply_limits(ax, cfg)
    _annotate_points(ax, cfg)
    return fig


def _pad_point_limits(ax, cfg, xs, ys, radius_pt, top_pt=0.0):
    """点/气泡图：按标记半径和标签高度给自动范围留余量，避免被坐标轴裁掉。"""
    width_in, height_in = cfg["figsize"]
    position = ax.get_position()
    plot_w_in = max(0.6, width_in * position.width)
    plot_h_in = max(0.6, height_in * position.height)
    y_low, y_high = ax.get_ylim()
    x_low, x_high = ax.get_xlim()
    pad_x = (radius_pt + 1.0) / 72.0 * (x_high - x_low) / plot_w_in
    pad_y = (radius_pt + 1.0) / 72.0 * (y_high - y_low) / plot_h_in
    top_y = (radius_pt + top_pt + 1.0) / 72.0 * (y_high - y_low) / plot_h_in
    ax.set_xlim(min(x_low, min(xs) - pad_x), max(x_high, max(xs) + pad_x))
    if cfg["y_min"] is None and cfg["y_max"] is None:
        ax.set_ylim(min(y_low, min(ys) - pad_y), max(y_high, max(ys) + top_y))


def _render_bubble(cfg):
    points = cfg["points"]
    fig, ax = _frame(cfg, left_in=0.66, right_in=0.24)
    _style_axes(ax, cfg, grid_axis="both")

    biggest = max(point["size"] for point in points) or 1.0
    sizes = [max(34.0, 700.0 * point["size"] / biggest) for point in points]
    ax.scatter([point["x"] for point in points], [point["y"] for point in points],
               s=sizes, c=BLUE, edgecolor=BLUE, linewidth=0.8, alpha=0.45, zorder=3)

    for point, size in zip(points, sizes):
        if not point["label"]:
            continue
        offset = math.sqrt(size) / 2.0 + 3.0
        ax.annotate(point["label"], xy=(point["x"], point["y"]), xytext=(0, offset),
                    textcoords="offset points", ha="center", va="bottom",
                    fontsize=7.2, color=INK)

    _pad_point_limits(ax, cfg, [point["x"] for point in points],
                      [point["y"] for point in points],
                      radius_pt=math.sqrt(max(sizes)) / 2.0, top_pt=13.0)
    _apply_limits(ax, cfg)
    _annotate_points(ax, cfg)
    return fig


def _sequence_cmap(color):
    return LinearSegmentedColormap.from_list(
        "dsh_seq", ["#F6F9FC", "#DEE8F2", color])


def _resolve_cmap(name, cid, ctype):
    if name is None:
        return _sequence_cmap(BLUE)
    text = str(name).strip()
    if text.startswith("#") and len(text) in (4, 7):
        return _sequence_cmap(text)
    try:
        if text in matplotlib.colormaps:
            return matplotlib.colormaps[text]
    except Exception:
        pass
    token = palette.CHART.get(text.upper())
    if token:
        return _sequence_cmap("#" + token)
    _fail(cid, ctype, "cmap=%r 不是可用的 colormap（可用 matplotlib 名称或 BLUE/TEAL/AMBER/RED/GREEN）" % name)


def _render_heatmap(cfg):
    matrix = cfg["matrix"]
    rows = len(matrix)
    cols = len(matrix[0])
    cmap = _resolve_cmap(cfg["cmap"], cfg["id"], cfg["type"])
    left_in = _clamp(0.26 + _text_width_in(cfg["row_labels"]) + 0.10, 0.60, 2.6)
    fig, ax = _frame(cfg, left_in=left_in, right_in=0.46, top_extra_in=0.20,
                     legend_in=0.0)

    flat = [value for row in matrix for value in row]
    image = ax.imshow(matrix, cmap=cmap, aspect="auto", interpolation="nearest",
                      vmin=min(flat), vmax=max(flat))

    ax.set_xticks(list(range(cols)))
    ax.set_xticklabels(cfg["col_labels"], fontsize=8.0)
    ax.set_yticks(list(range(rows)))
    ax.set_yticklabels(cfg["row_labels"], fontsize=8.0)
    ax.xaxis.tick_top()
    ax.tick_params(axis="both", length=0, colors=INK, labelsize=8.0)

    if _text_width_in(cfg["col_labels"], 8.0) * 1.05 > (cols and (cfg["figsize"][0] - left_in) / cols):
        for text in ax.get_xticklabels():
            text.set_rotation(28)
            text.set_ha("right")
            text.set_rotation_mode("anchor")
            text.set_verticalalignment("bottom")

    # 单元格白色分隔线 + 数值
    ax.set_xticks([index - 0.5 for index in range(cols + 1)], minor=True)
    ax.set_yticks([index - 0.5 for index in range(rows + 1)], minor=True)
    ax.grid(which="minor", color="white", linewidth=1.2)
    ax.tick_params(which="minor", length=0)
    ax.set_axisbelow(False)
    for spine in ax.spines.values():
        spine.set_visible(False)

    fmt = cfg["value_fmt"] or "{:.1f}"
    fontsize = 7.8 if rows * cols <= 30 else 6.6
    norm = image.norm
    for r_index, row in enumerate(matrix):
        for c_index, value in enumerate(row):
            rgba = cmap(norm(value))
            luminance = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]
            ax.text(c_index, r_index, _value_text(value, fmt), ha="center", va="center",
                    fontsize=fontsize, color="white" if luminance < 0.55 else INK,
                    zorder=5)

    if cfg["highlight_cell"]:
        r_index, c_index = cfg["highlight_cell"]
        ax.add_patch(Rectangle((c_index - 0.5, r_index - 0.5), 1, 1, fill=False,
                               edgecolor=INK, linewidth=1.6, zorder=6))

    colorbar = fig.colorbar(image, ax=ax, fraction=0.035, pad=0.02)
    colorbar.outline.set_linewidth(0.4)
    colorbar.outline.set_edgecolor(GREY)
    colorbar.ax.tick_params(labelsize=7, length=2, width=0.6, colors=INK)
    return fig


def _render_waterfall(cfg):
    steps = cfg["steps"]
    count = len(steps)
    fig, ax = _frame(cfg, left_in=0.68, right_in=0.24, legend_in=0.25)
    _style_axes(ax, cfg)

    positions = list(range(count))
    bottoms, heights, colors, running, levels = [], [], [], 0.0, []
    for step in steps:
        value = step["value"]
        if step["kind"] == "total":
            bottoms.append(0.0)
            heights.append(value)
            colors.append(BLUE)
            running = value
        elif value >= 0:
            bottoms.append(running)
            heights.append(value)
            colors.append(GREEN)
            running += value
        else:
            bottoms.append(running + value)
            heights.append(-value)
            colors.append(RED)
            running += value
        levels.append(running)

    ax.bar(positions, heights, bottom=bottoms, width=0.60, color=colors,
           edgecolor="white", linewidth=0.6, zorder=3)

    for index in range(count - 1):
        level = levels[index]
        ax.plot([index + 0.30, index + 1 - 0.30], [level, level], color=GREY,
                linewidth=0.6, linestyle=(0, (2, 2)), zorder=2)

    if cfg["value_labels"]:
        fmt = cfg["value_fmt"] or _label_fmt([step["value"] for step in steps])
        for index, step in enumerate(steps):
            top = bottoms[index] + heights[index]
            if step["kind"] == "total":
                text = _value_text(step["value"], fmt)
            else:
                signed = "+" if step["value"] >= 0 else "-"
                text = signed + _value_text(abs(step["value"]), fmt)
            ax.annotate(text, xy=(positions[index], top), xytext=(0, 2),
                        textcoords="offset points", ha="center", va="bottom",
                        fontsize=7.2, color=INK)

    lowest = min([0.0] + bottoms)
    highest = max([0.0] + [bottom + height for bottom, height in zip(bottoms, heights)])
    span = (highest - lowest) or 1.0
    if cfg["y_min"] is None:
        ax.set_ylim(lowest - span * 0.06, None)
    _apply_limits(ax, cfg)

    ax.set_xticks(positions)
    ax.set_xticklabels([step["label"] for step in steps], fontsize=8.0)
    available = cfg["figsize"][0] * 0.82
    if _text_width_in([step["label"] for step in steps], 8.0) * count > available:
        for text in ax.get_xticklabels():
            text.set_rotation(28)
            text.set_ha("right")
            text.set_rotation_mode("anchor")
    ax.set_xlim(-0.65, count - 0.35)

    handles, labels = [], []
    if any(step["kind"] == "delta" and step["value"] >= 0 for step in steps):
        handles.append(Patch(facecolor=GREEN, edgecolor="none"))
        labels.append("增加")
    if any(step["kind"] == "delta" and step["value"] < 0 for step in steps):
        handles.append(Patch(facecolor=RED, edgecolor="none"))
        labels.append("减少")
    if any(step["kind"] == "total" for step in steps):
        handles.append(Patch(facecolor=BLUE, edgecolor="none"))
        labels.append("合计")
    if cfg["legend"] and handles:
        _legend_above(ax, handles, labels, len(handles))
    return fig


def _render_donut(cfg):
    labels = cfg["labels"]
    values = cfg["values"]
    total = sum(values)
    count = len(labels)
    ncol = 2 if count <= 4 else 3
    rows = int(math.ceil(count / float(ncol)))
    legend_in = 0.19 * rows + 0.10

    fig, ax = _frame(cfg, left_in=0.24, right_in=0.24, bottom_extra_in=legend_in,
                     legend_in=0.0)
    colors = [palette.series_color(index) for index in range(count)]
    wedges, _texts, autotexts = ax.pie(
        values, colors=colors, startangle=90, counterclock=False,
        autopct=lambda pct: ("%d%%" % int(round(pct))) if pct >= 7 else "",
        pctdistance=0.79, textprops=dict(fontsize=7.4),
        wedgeprops=dict(width=0.42, edgecolor="white", linewidth=1.2))
    for wedge, text in zip(wedges, autotexts):
        rgba = wedge.get_facecolor()
        luminance = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]
        text.set_color("white" if luminance < 0.6 else INK)
        text.set_fontsize(7.4)
        if luminance < 0.6:
            text.set_fontweight("bold")
    if cfg["center"]:
        ax.text(0.0, 0.0, cfg["center"], ha="center", va="center",
                fontsize=9.4, color=INK)
    ax.set_aspect("equal")

    fmt = cfg["value_fmt"] or _label_fmt(values)
    entries = ["%s %s（%.1f%%）" % (label, _value_text(value, fmt), 100.0 * value / total)
               for label, value in zip(labels, values)]
    if cfg["legend"] and count > 1:
        legend = ax.legend(wedges, entries, loc="upper center", bbox_to_anchor=(0.5, -0.02),
                           ncol=ncol, frameon=False, fontsize=7.8, handlelength=1.1,
                           handletextpad=0.5, columnspacing=1.6, borderaxespad=0.0)
        for text in legend.get_texts():
            text.set_color(INK)
    return fig


RENDERERS = {
    "line": _render_line,
    "area": _render_area,
    "bar": _render_bar,
    "grouped_bar": _render_bar,
    "stacked_bar": _render_bar,
    "barh": _render_barh,
    "combo": _render_combo,
    "scatter": _render_scatter,
    "bubble": _render_bubble,
    "heatmap": _render_heatmap,
    "waterfall": _render_waterfall,
    "donut": _render_donut,
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="make_charts.py",
        description="按 spec.json 生成研究报告图表（PNG，白底 dpi 200）。")
    parser.add_argument("--spec", required=True, help="图表规格 JSON 路径")
    parser.add_argument("--out-dir", required=True, help="PNG 输出目录")
    parser.add_argument("--json", action="store_true", help="stdout 只输出一份 JSON")
    parser.add_argument("--dpi", type=int, default=None, help="覆盖 spec 的 dpi（默认 200）")
    parser.add_argument("--width-in", type=float, default=None,
                        help="覆盖 spec 的图宽，单位 inch（默认 6.3）")
    return parser.parse_args(argv)


def _load_spec(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise SpecError(["找不到 spec 文件：%s" % path])
    except json.JSONDecodeError as exc:
        raise SpecError(["spec JSON 解析失败（第 %d 行第 %d 列）：%s"
                         % (exc.lineno, exc.colno, exc.msg)])
    except UnicodeDecodeError as exc:
        raise SpecError(["spec 文件不是 UTF-8：%s" % exc])
    except OSError as exc:
        raise SpecError(["读取 spec 失败：%s" % exc])


def _report_failure(messages, args):
    for message in messages:
        sys.stderr.write("make_charts.py: 错误: %s\n" % message)
    sys.stderr.flush()
    if args.json:
        payload = {"ok": False, "error": messages[0], "errors": list(messages)}
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 1


def main(argv=None):
    args = _parse_args(argv)

    try:
        spec = _load_spec(os.path.abspath(args.spec))
        width_in, dpi, charts, warnings = _validate_spec(spec, args)
    except SpecError as exc:
        return _report_failure(exc.errors, args)

    _setup()
    for cfg in charts:
        cfg["warnings"] = warnings

    out_dir = os.path.abspath(args.out_dir)
    stage_dir = None
    rendered = []
    try:
        os.makedirs(out_dir, exist_ok=True)
        stage_dir = tempfile.mkdtemp(prefix=".chartstage-", dir=out_dir)
        for cfg in charts:
            staged = os.path.join(stage_dir, cfg["filename"])
            try:
                fig = RENDERERS[cfg["type"]](cfg)
            except ChartError:
                raise
            except Exception as exc:                     # noqa: BLE001 - 转成带 id 的错误
                raise ChartError(cfg["id"], cfg["type"], "绘制失败：%s: %s"
                                 % (type(exc).__name__, exc))
            if fig is not None:
                _finalize_note(fig)
                palette.save_fig(fig, staged, dpi=dpi)
                plt.close(fig)
            size = os.path.getsize(staged) if os.path.exists(staged) else 0
            if size <= 0:
                raise ChartError(cfg["id"], cfg["type"], "PNG 写出失败（文件为空）")
            rendered.append((cfg, staged, size))

        # 全部成功后才落到 out-dir，避免留下半成品
        results = []
        for cfg, staged, size in rendered:
            final = os.path.join(out_dir, cfg["filename"])
            os.replace(staged, final)
            results.append({
                "id": cfg["id"],
                "type": cfg["type"],
                "path": final,
                "title": cfg["title"] or "",
                "bytes": size,
                "width_in": round(cfg["figsize"][0], 2),
                "height_in": round(cfg["figsize"][1], 2),
            })
    except ChartError as exc:
        return _report_failure([exc.describe()], args)
    except OSError as exc:
        return _report_failure(["写文件失败：%s" % exc], args)
    finally:
        if stage_dir and os.path.isdir(stage_dir):
            shutil.rmtree(stage_dir, ignore_errors=True)

    if not args.json:
        for result in results:
            sys.stdout.write("[%2d/%2d] %-4s %-12s %7.1f KB  %s\n"
                             % (results.index(result) + 1, len(results), result["id"],
                                result["type"], result["bytes"] / 1024.0, result["path"]))
        sys.stdout.write("图表输出目录：%s\n" % out_dir)

    payload = {
        "ok": True,
        "charts": results,
        "warnings": warnings,
        "out_dir": out_dir,
        "dpi": dpi,
        "width_in": width_in,
        "count": len(results),
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
