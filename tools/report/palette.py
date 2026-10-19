# -*- coding: utf-8 -*-
"""报告渲染管线的共享视觉常量。

word/PDF 侧（build_report_pdf.py）与图表侧（make_charts.py）都从这里取色，
保证一份报告里的表格、结论框、图表是同一套视觉语言。只放常量与通用函数，
不要在这里写业务逻辑。
"""
import os

# ---- Word / PDF ----
DOCX = {
    "NAVY": "142B47",
    "BLUE": "1F4E79",
    "DARK": "222830",
    "GREY": "5A6470",
    "RED": "A82F22",
    "AMBER": "9A631E",
    "BORDER": "C9D2DC",
    "LIGHT": "F5F8FB",
    "WHITE": "FFFFFF",
}

# ---- 图表 ----
CHART = {
    "INK": "1A2332",
    "GRID": "DFE4EA",
    "BLUE": "1F4E79",
    "TEAL": "2F7D8F",
    "AMBER": "C8843C",
    "RED": "B03A2E",
    "GREEN": "3D7A4F",
    "GREY": "8D99AE",
}

# 默认取色顺序（多序列图表按此循环）
SERIES = ["BLUE", "AMBER", "TEAL", "RED", "GREEN", "GREY"]

# 字体
EA = "微软雅黑"
EA_BODY = "宋体"
LATIN = "Times New Roman"
LATIN_H = "微软雅黑"

# 页面
PAGE = {"width_cm": 21.0, "height_cm": 29.7, "margin_top_cm": 2.0,
        "margin_bottom_cm": 1.8, "margin_left_cm": 2.2, "margin_right_cm": 2.2}

# 图表默认尺寸
CHART_WIDTH_IN = 6.3
CHART_DPI = 200


def color(name, fallback="#1F4E79"):
    """按名字取图表色；也允许直接传 '#rrggbb'。"""
    if not name:
        return fallback
    if isinstance(name, str) and name.startswith("#"):
        return name
    hexv = CHART.get(str(name).upper())
    return "#" + hexv if hexv else fallback


def series_color(index):
    """第 index 条序列的颜色（循环取色）。"""
    key = SERIES[index % len(SERIES)]
    return "#" + CHART[key]


def setup_matplotlib():
    """统一 matplotlib 的中文字体、负号、网格风格。幂等，可重复调用。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    available = {f.name for f in font_manager.fontManager.ttflist}
    candidates = ["Microsoft YaHei", "微软雅黑", "SimHei", "Noto Sans CJK SC", "Source Han Sans SC"]
    chosen = next((c for c in candidates if c in available), None)
    plt.rcParams["font.sans-serif"] = ([chosen] if chosen else []) + ["DejaVu Sans"]
    plt.rcParams["font.family"] = "sans-serif"
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["axes.facecolor"] = "white"
    plt.rcParams["savefig.facecolor"] = "white"
    return plt


def save_fig(fig, path, dpi=CHART_DPI):
    """保存图表：白底、紧凑边界，并确保目录存在。"""
    out = os.path.abspath(path)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    fig.savefig(out, dpi=dpi, bbox_inches="tight", facecolor="white", edgecolor="none")
    return out
