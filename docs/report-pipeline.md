# 研究报告渲染管线 · 契约文档

> 目标：把一份 Markdown 研报 + 图表规格，渲染成一份「图文并茂」的中文 A4 PDF（封面、核心结论框、数据表、自动图表、图注、页脚页码）。
> 这份文档是 `tools/report/*` 的接口契约，改动 CLI/字段必须先改这里。

## 0. 目录约定

一次研究任务落在一个目录里（下称 `<report-dir>`）：

```
<report-dir>/
  report.md            # 正文（格式见 §4）
  report-meta.json     # 封面与页脚元数据（见 §5）
  charts/spec.json     # 图表规格（见 §3）
  charts/*.png         # 生成的图表
  data/*.json          # 四位大师的原始分析、交叉质证结果
  report.docx          # 中间产物（可编辑）
  report.pdf           # 最终交付物
```

## 1. 视觉规范（两条管线必须一致）

Word/PDF 侧（`build_report_pdf.py`）：

| token | 值 | 用途 |
|---|---|---|
| NAVY | `#142B47` | 封面标题、H2 标题、表头底色 |
| BLUE | `#1F4E79` | 强调、结论框边线、页码 |
| DARK | `#222830` | 正文 |
| GREY | `#5A6470` | 图注、页脚、辅助文字 |
| RED | `#A82F22` | 风险/负面强调 |
| AMBER | `#9A631E` | 副标题、分隔线、警告强调 |
| BORDER | `#C9D2DC` | 表格线 |
| LIGHT | `#F5F8FB` | 表格斑马行、结论框底色 |

图表侧（`make_charts.py`）：

| token | 值 |
|---|---|
| INK | `#1A2332` |
| GRID | `#DFE4EA` |
| BLUE | `#1F4E79` |
| TEAL | `#2F7D8F` |
| AMBER | `#C8843C` |
| RED | `#B03A2E` |
| GREEN | `#3D7A4F` |
| GREY | `#8D99AE` |

字体：正文 `宋体` + 拉丁 `Times New Roman`，10.5pt，行距 1.45，两端对齐；标题用 `微软雅黑`；图表文本用 `Microsoft YaHei`。
页面：A4 纵向，页边距 上 2.0 / 下 1.8 / 左 2.2 / 右 2.2 cm。

## 2. `tools/report/palette.py`

被两个脚本共同 import，只放常量与少量通用函数，不改业务逻辑：

```python
DOCX = {"NAVY": "142B47", "BLUE": "1F4E79", "DARK": "222830", "GREY": "5A6470",
        "RED": "A82F22", "AMBER": "9A631E", "BORDER": "C9D2DC", "LIGHT": "F5F8FB"}
CHART = {"INK": "1A2332", "GRID": "DFE4EA", "BLUE": "1F4E79", "TEAL": "2F7D8F",
         "AMBER": "C8843C", "RED": "B03A2E", "GREEN": "3D7A4F", "GREY": "8D99AE"}
SERIES = ["BLUE", "AMBER", "TEAL", "RED", "GREEN", "GREY"]   # 默认取色顺序
EA = "微软雅黑"; EA_BODY = "宋体"; LATIN = "Times New Roman"
def setup_matplotlib(): ...   # rcParams: font.sans-serif=[Microsoft YaHei, SimHei], axes.unicode_minus=False
def save_fig(fig, path, dpi=200): ...  # bbox_inches="tight", facecolor="white"
```

## 3. `make_charts.py` — 图表生成

```text
python make_charts.py --spec <spec.json> --out-dir <dir> [--json] [--dpi 200] [--width-in 6.3]
```

- 成功：stdout 打印一份 JSON（`--json` 时只打印 JSON），退出码 0：
  `{"ok":true,"charts":[{"id":"c1","type":"line","path":"<abs png>","title":"..."}],"warnings":["..."]}`
- 失败：退出码 1，stderr 给出具体原因（缺数据、类型不支持、NaN 等），不留半成品文件。
- 每个图自动加：左对齐标题（11pt、加粗）、可选副标题、来源脚注（7.6pt 灰，`fig.text` 左下）。
- 图片宽度默认 6.3in、dpi 200（≈1260px），白底。

### spec.json

```json
{
  "width_in": 6.3,
  "dpi": 200,
  "charts": [
    {
      "id": "c1",
      "type": "line",
      "title": "营业收入与归母净利润：十年十倍之后增速换挡",
      "subtitle": "单位：亿元",
      "footnote": "资料来源：公司年报，2026 三季报。",
      "x": ["2016", "2017", "2018"],
      "y_label": "亿元",
      "series": [
        { "name": "营业收入", "values": [388.6, 582.2, 736.4], "color": "BLUE", "kind": "line" },
        { "name": "归母净利润", "values": [167.2, 270.8, 352.0], "color": "AMBER", "kind": "line" }
      ],
      "annotate": [{ "text": "2026 前三季度", "x": "2026E", "y": 1200 }],
      "highlight": "2026E"
    }
  ]
}
```

支持的 `type`（必须全部实现）：

| type | 必填字段 | 说明 |
|---|---|---|
| `line` | `x`, `series[].values` | 折线，可多序列；`highlight` 高亮某个 x |
| `bar` | `x`, `series` | 单/多序列竖柱；`stacked` 可选 |
| `barh` | `labels`, `values` | 横向条形，用于排名/结构 |
| `grouped_bar` | `x`, `series` | 分组柱（同比/同业对比） |
| `stacked_bar` | `x`, `series` | 堆叠柱 |
| `combo` | `x`, `series`（`kind: bar|line`，`axis: left|right`） | 柱+线双轴（如分红+派息率） |
| `scatter` | `points:[{x,y,label?}]` | 散点（如 PE-ROE） |
| `bubble` | `points:[{x,y,size,label?}]` | 气泡（size=市值），气泡内不写字，关键点标 label |
| `heatmap` | `matrix`, `row_labels`, `col_labels`, `cmap`, `value_fmt`, `highlight_cell` | 矩阵热力图（IRR 敏感性），格内标数值，`highlight_cell:[r,c]` 黑框标注 |
| `waterfall` | `steps:[{label,value,kind:"delta"|"total"}]` | 瀑布图（利润拆解） |
| `donut` | `labels`, `values` | 环形占比 |
| `area` | `x`, `series` | 堆叠面积 |

通用可选字段：`subtitle`、`footnote`、`y_label`、`x_label`、`y_min`、`y_max`、`value_fmt`（如 `"{:.1f}%"`）、
`annotate:[{text,x,y,color?}]`、`highlight`（x 值或序列名）、`legend`（默认 true）、`grid`（默认 true）、
`size`（图内 inch 覆盖）、`reverse`（barh 是否倒序）。

## 4. `report.md` 支持的 Markdown 子集

| 语法 | 渲染 |
|---|---|
| `# 标题` | 文档大标题（若 meta 未给 title 时使用；一般省略） |
| `## 一、章节` | H2：15pt NAVY、左侧 4mm 竖线、段前分页（**只有 `## ` 一级自动分页**），带编号原样显示 |
| `### 1.1 小节` | H3：11.5pt 深蓝 |
| `#### 要点` | H4：10.5pt 加粗 |
| 普通段落 | 首行不缩进、两端对齐、1.45 行距 |
| `- 项目` / `  - 子项` | 项目符号，二级缩进 |
| `1. 项目` | 有序列表 |
| `| a | b |` 表格 | 表头 NAVY 底白字，偶数行 LIGHT，自动列宽；尽量每页内放完 |
| `![图 1：说明](charts/c1.png)` | 居中插图（最大 15.6cm 宽）+ 下方 8.5pt 灰图注「图 1：说明」 |
| `> 引用文字` | 浅底色 + 左侧 3pt BLUE 边线的结论框；首行 `**核心结论**` 自动加粗 |
| `---` | 细分隔线 |
| `<!-- pagebreak -->` | 强制分页 |
| 行内 `**粗体**`、`*斜体*`、`` `代码` ``、`[文字](url)` | 粗体/斜体/等宽/蓝色下划线文字（链接不做可点击，避免依赖关系项） |

约定：正文不要写 H1；章节标题保留「一、二、三」；图片路径相对 `<report-dir>`；**每个 `##` 章节至少 1 个图表或表格**（质量门槛会检查）。

## 5. `report-meta.json`

```json
{
  "title": "贵州茅台",
  "ticker": "600519.SH",
  "kicker": "把确定性装进资产负债表",
  "subtitle": "深度研究报告 · 四大师投研框架",
  "as_of": "2026-10-20",
  "cover": { "path": "cover.jpg" },
  "metrics": [
    { "label": "收盘价（2026-10-19）", "value": "1,580.00 元" },
    { "label": "总市值", "value": "19,845 亿元" },
    { "label": "PE（TTM）", "value": "21.3 倍" },
    { "label": "股息率", "value": "3.1%" }
  ],
  "core": {
    "title": "核心结论",
    "paragraphs": ["……", "……"],
    "verdict": "当前价格处于「合理偏上」，值得持有，不值得加仓"
  },
  "sources_asof": "2026 年三季报 + 2026-10-19 收盘行情",
  "disclaimer": "本报告不构成投资建议。投资有风险，入市需谨慎。",
  "footer": "贵州茅台（600519.SH）深度研究 · 不构成投资建议"
}
```

- `cover` 可省略：省略时渲染「深色文字封面」（NAVY 大标题 + 细金线 + 指标表），保证任何报告都有像样首页。
- `cover` 给了图片时：图片**永远铺满 16.6cm 版心宽度**，高度上限 7.2cm，超出部分上下居中裁切（不读 DPI 元数据，也不整体缩小留白边）；封面必须单页排完。
- `metrics` 2–4 项；`core.paragraphs` 1–3 段；`core.verdict` 一行结论（RED/NAVY 强调）。
- `footer` 可省略，默认 `{title}（{ticker}）· 深度研究 · 不构成投资建议`。

## 6. `build_report_pdf.py`

```text
python build_report_pdf.py --md <report.md> --out-dir <dir> --meta <report-meta.json>
       [--engine auto|libreoffice|soffice|word|chrome] [--title ...] [--json] [--keep-docx]
```

- `--engine auto`（默认）：依次探测（a）DSH LibreOffice Kit（环境变量 `DSH_LO_NODE`/`DSH_LO_CLI` 或常见安装路径）→（b）系统 `soffice` →（c）Windows Word COM → 都不可用则退出码 1 并给出安装提示。
- 输出：`<out-dir>/report.docx`（除非 `--no-docx`）+ `<out-dir>/report.pdf`。
- 成功 JSON（`--json` 时只输出 JSON）：
  `{"ok":true,"docx":"...","pdf":"...","pages":16,"bytes":1612345,"images":7,"engine":"libreoffice","warnings":["..."]}`
- 校验：PDF 以 `%PDF-` 开头、`pages>=1`、正文非空；`images` 用 `/Subtype /Image` 计数（近似值，允许误差）。
- 失败：退出码 1，stderr 指出失败阶段（parse/docx/convert/validate）与原始错误。
- 依赖：只允许 `python-docx` + 标准库；不依赖 reportlab/weasyprint/pandas。

## 7. `check_pdf.py`

```text
python check_pdf.py --pdf <report.pdf> [--json] [--render-pages 3 --render-dir <dir>]
```

输出 `{"ok":true,"pages":16,"bytes":...,"images":7,"text_chars":48210,"has_cover_text":true,"render":{"pages":[png...]}}`。
页数优先用 `pdfinfo`，没有则回退到扫描 `/Type /Page`；渲染用 `pdftoppm`（找不到就跳过，不报错）。

## 8. 质量门槛（audit agent 必须校验）

1. `pages >= 8`
2. PDF 内嵌图片 `>= 4`
3. `report.md` 中每个 `![...](path)` 的文件真实存在
4. 正文没有 `TODO` / `待补` / `XXX` / 未替换的 `{{` 占位符
5. 封面页含公司名与报告日；页脚有页码
6. 关键数字（营收、净利、PE、市值）在正文出现，且能在 `data/*.json` 的来源里找到出处；`data/evidence.json` 必须存在且是合法 JSON（四位大师原始分析 + 交叉质证），缺失即记 issues

## 9. 一键调用（插件工具）

插件注册了三个工具，agent 优先用它们（内部就是上面的脚本）：

- `invest_chart`：参数 `{ spec | specPath, outDir }`
- `invest_report_pdf`：参数 `{ md, meta | metaPath, outDir, engine? }`
- `invest_pdf_check`：参数 `{ pdf, renderPages? }`

脚本位于 `packages/dsh-invest-bundle/tools/report/`；本地 link 安装时源码改动需重启 DSH 才生效。
