---
name: report-publish
description: 研报排版与 PDF 交付：把 report.md + 图表 spec 渲染成图文并茂的 A4 PDF（封面、核心结论框、表格、图注、页脚页码），并做页数/插图/占位符/关键数字的准出检查。适用于任何「已经写完稿、要出 PDF」或「PDF 排版出问题要修」的场合。
whenToUse: 已经有 Markdown 稿或数据，需要生成/修复 PDF 研报；需要设计风格统一的图表；需要检查 PDF 是否达到「图文并茂」交付标准时使用。
---

# 研报排版与 PDF 交付

## 交付物长什么样

一份合格的 PDF 研报：A4、8 页以上、4 张以上图表、有封面（公司名 + 报告日 + 指标表 + 核心结论框）、章节带编号、表格斑马纹、图注说明结论、页脚有页码与免责声明。`.md` 与 `.docx` 都只是中间产物。

## 一条命令出 PDF（最常用）

1. 先确认报告目录里有 `report.md` 与 `report-meta.json`（字段见 `docs/report-pipeline.md` §5）。
2. 调 `invest_report_pdf`：

```json
{ "md": "D:/work/reports/贵州茅台-深度研究-2026-10-20/report.md",
  "outDir": "D:/work/reports/贵州茅台-深度研究-2026-10-20",
  "metaPath": "D:/work/reports/贵州茅台-深度研究-2026-10-20/report-meta.json" }
```

3. 返回 `{pdf, docx, pages, images, engine}`。然后 `invest_pdf_check` 复核：

```json
{ "pdf": ".../report.pdf", "renderPages": 3, "renderDir": ".../preview" }
```

4. 达标线：`pages >= 8` 且 `images >= 4`；渲染出的 PNG 要目检（封面、表格、图注、页码、中文无方块）。

也可以直接跑 Python（调试时更方便）：

```text
python tools/report/build_report_pdf.py --md report.md --out-dir . --meta report-meta.json --json
python tools/report/check_pdf.py --pdf report.pdf --json --render-pages 3 --render-dir preview
```

## 图表：spec 驱动，不逐图写代码

调 `invest_chart`，`spec` 内联（工具会写到 `<outDir>/charts/spec.json`），或先写文件再传 `specPath`。

```json
{ "spec": { "width_in": 6.3, "dpi": 200, "charts": [
  { "id": "c1", "type": "line", "title": "营收与净利：增速换挡", "subtitle": "单位：亿元",
    "footnote": "资料来源：公司年报、2026 三季报。",
    "x": ["2021", "2022", "2023", "2024", "2025"],
    "series": [ { "name": "营业收入", "values": [1095, 1276, 1477, 1709, 1688], "color": "BLUE" },
                { "name": "归母净利润", "values": [525, 627, 747, 862, 823], "color": "AMBER" } ],
    "highlight": "2025" } ] },
  "outDir": "D:/work/reports/贵州茅台-深度研究-2026-10-20" }
```

- `type`：`line / bar / barh / grouped_bar / stacked_bar / combo / scatter / bubble / heatmap / waterfall / donut / area`。
- 配色只从 `BLUE / AMBER / TEAL / RED / GREEN / GREY` 里取；默认顺序 BLUE→AMBER→TEAL→RED→GREEN→GREY。
- 每张图必须有：结论式标题（说结论，不是「营收走势图」）、单位、`footnote` 来源。
- 一篇长文 5-7 张图，覆盖：趋势（line/combo）、结构（barh/donut）、对比（grouped_bar）、敏感性（heatmap）、拆解（waterfall）、估值（scatter/bubble）。
- 图里的数字必须来自正文/`data/*.json`，**不许新造**。

## `report-meta.json` 要点

```json
{ "title": "贵州茅台", "ticker": "600519.SH", "kicker": "把确定性装进资产负债表",
  "subtitle": "深度研究报告 · 四大师投研框架", "as_of": "2026-10-20",
  "cover": { "path": "cover.jpg" },
  "metrics": [ { "label": "收盘价", "value": "1,580.00 元" }, { "label": "总市值", "value": "19,845 亿元" } ],
  "core": { "title": "核心结论", "paragraphs": ["……"], "verdict": "合理偏上：持有，不加仓" },
  "sources_asof": "2026 三季报 + 2026-10-19 收盘",
  "footer": "贵州茅台（600519.SH）深度研究 · 不构成投资建议" }
```

- `metrics` 2-4 个，数字必须已核实；没核实就删掉，别写「待核实」占位。
- `cover.path` 可省略：省略时用排版封面（NAVY 大标题 + 金线 + 指标表 + 结论框）。
- `core.verdict` 必须是一句明确结论。

## Markdown 子集（写错会丢内容）

支持：`##`（自动分页）/ `###` / `####`、段落、`- ` 列表、`1. ` 有序列表、管道表格、`![图 N：说明](charts/c1.png)`、`> 结论框`、`---`、`<!-- pagebreak -->`、行内 `**粗体** *斜体* \`代码\` [文字](url)`。

不支持：HTML 标签、代码块、嵌套引用、脚注、任务列表、多级标题跳级。图片路径相对 `report.md` 所在目录。

## 常见故障与修法

| 现象 | 原因 | 修法 |
|---|---|---|
| 图片空白/丢失 | 路径相对错了 | 图片放 `<report-dir>/charts/`，正文写 `charts/xxx.png` |
| 页数不足 8 | 正文太短/图表太少 | 补章节、补表格、补 2-3 张图（不要靠放大字号凑页） |
| 插图数不足 4 | spec 只生成 1-2 张 | 按上面 5 类各补一张，重跑 `invest_chart` |
| PDF 引擎失败 | 没装 LibreOffice/Kit | `engine=soffice` 或装 LibreOffice；Windows 可试 `engine=word`；最后 `engine=chrome`（无页码） |
| 中文方块 | 字体缺失 | 需要宋体/微软雅黑；Linux 装 Noto CJK 或改 palette 字体 |
| 表格溢出 | 列太多/文字太长 | 拆成两张表、缩短列名、数值保留 1 位小数 |
| 页脚没页码 | 转换器不认 PAGE 域 | 优先 LibreOffice Kit；Word COM 也认 |
| 段落首行有奇怪缩进 | 用了 `# ` H1 | 正文只用 `##` 起 |

## 准出检查（交付前必须过）

1. `invest_pdf_check`：`pages >= 8`、`images >= 4`、能提取出正文文本。
2. `renderPages=3` 目检：封面有公司名与日期、指标表对齐、结论框不破、图注在图片下方、页码正常。
3. 正文搜索：`TODO`、`待补`、`XXX`、`{{`、`<!-- figure` 必须为 0。
4. 每个 `![...](path)` 的文件都存在。
5. 关键数字（营收、净利、毛利率、PE、市值、股息率）在正文与图表里一致，且能追到来源。

任何一项不过，修完重跑，不得把 md/docx 冒充 PDF 交付。
