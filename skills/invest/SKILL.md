---
name: invest
description: 投研总控技能：把 ai-berkshire 的四大师方法论、数值严谨工具与本插件自带的检索/抓取/审计/验证通道串成一条可执行流水线。任何"研究一家公司/写一篇研报/看一份财报"的请求都从本技能进入。
whenToUse: 投研,研报,研究报告,深度研究,财报分析,估值,护城河,买入决策,持仓跟踪,行业研究
---

# 投研总控（dsh-invest-bundle）

这个技能是入口。具体方法论按需调用 skills 目录下的 21 个 berkshire 技能（`investment-research`、`earnings-review`、`industry-funnel`、`quality-screen`、`investment-team` 等）。本技能只规定**顺序、工具和不可违反的底线**。

## 先选路

- **单点问题**（一句话估值、某条新闻、某个指标、财报里某一项）→ 直接走下面的标准流水线，产出 md。
- **公司深度研究 / 要团队并行 / 用户要「看到 agent 进度」/ 要一份 PDF** → 走 `investment-team` 技能：调用 `invest_workflow` 取脚本，再用 `workflow` 工具发起四大师并行，最终交付 PDF。深度研究的**唯一完成判据是 PDF**（pages>=8、images>=4），不是 md。
- **已经有稿子，只差排版** → 走 `report-publish` 技能（`invest_chart` / `invest_report_pdf` / `invest_pdf_check`）。

## 第〇步：联网可用性预检（不可跳过）

1. 先调用 `invest_channels`。
2. 如果「invest_search」不是 ✅，或检索返回 `degraded=true` 且结果为空：**立刻停下来告诉用户**「当前只有降级检索通道 / 检索不可用」，并给出修复建议（加 `TAVILY_API_KEY`）。
3. 如果本轮完全无法联网：**停止**，明确说明"本轮无联网能力，无法产出可信研报"，禁止凭记忆编造数据或伪造来源。
4. 每一条要写进结论的事实，必须能追到**本轮实际抓取到的 URL**。抓不到就写"未获取到"，不要写"据公开资料"。

## 工具分工

| 工具 | 用途 | 什么时候用 |
|---|---|---|
| `invest_channels` | 通道健康度体检 | 每次开工第一步 |
| `invest_search` | 三路降级检索（Tavily→Exa→DDG） | 找财报/公告/纪要/行业数据的入口 |
| `invest_fetch` | 正文抓取（直抓→r.jina.ai） | 把入口变成可引用的正文 |
| `invest_audit` | 读正文的五维可信度打分 | 来源筛选，决定谁进正文 |
| `invest_verify` | 数字+短语覆盖率交叉验证 | 关键断言（尤其带数字的）落笔前 |
| `invest_rigor` | 跑随包 Python 工具 | 任何计算、验算、准出审核 |
| `invest_workflow` | 取四大师 workflow 脚本 + meta + 预填 args | 公司深度研究、团队并行、要 PDF 时 |
| `invest_chart` | spec 驱动生成统一配色图表 | 研报插图（5-7 张） |
| `invest_report_pdf` | report.md + meta → 图文并茂 PDF | 出最终交付物 |
| `invest_pdf_check` | 页数/插图/渲染目检 | PDF 准出前 |

## 标准流水线

1. **体检**：`invest_channels`
2. **定题**：确认标的、期间、报告类型（深度研究 / 财报精读 / 行业 / 持仓复盘）；缺信息就问，不要假设。
3. **找一个手源**：`invest_search` 优先定向到官方源——
   - A股：`site:cninfo.com.cn`（巨潮）、`site:sse.com.cn`、`site:szse.cn`
   - 港股：`site:hkexnews.hk`（披露易）
   - 美股：`site:sec.gov`（10-K/10-Q/8-K）、公司 IR 页
   - 台股：FinMind / `invest_rigor` 的 `twstock_data.py`
4. **抓正文**：`invest_fetch`（≤6 条/次）。失败就换入口，不要用摘要凑。
5. **审来源**：`invest_audit`，只让 🟢/🟡 进正文，🔴 丢弃并说明原因。
6. **跑方法论**：加载对应 berkshire 技能（如 `earnings-review`），按其步骤产出；原文要求的表格、清单、红线一条都不能省。
7. **验算**：所有数字用 `invest_rigor` 跑 `financial_rigor.py`：
   - `verify-market-cap`（市值反算，偏差 >5% ❌ / >1% ⚠️）
   - `cross-validate --tolerance 1.0`（两源交叉，误差 >1% 必须标记）
   - `verify-valuation`、`three-scenario`、`benford`（n<50 只作参考）
8. **验断言**：关键断言用 `invest_verify` 复核；`contradicted` 必须先查清哪个数字对。
9. **落盘**：写入 `reports/<标的>-<类型>-<期间>/report.md`，末尾必须带「数据来源与抓取时间」表；封面元数据写 `report-meta.json`。
10. **出 PDF（深度研究必做）**：`invest_chart` 生成 5-7 张图并替换正文占位符 → `invest_report_pdf` 渲染 → `invest_pdf_check` 校验 `pages>=8 && images>=4`。**md/docx 不是交付物，PDF 才是**；不达标就补图/补正文重跑。
11. **准出**：`invest_rigor` 跑 `report_audit.py extract` → 逐项复核 → `verdict`；判打回就改，改完再审。深度研究还要检查 PDF 里每个关键数字可溯源。

## 硬性底线

- **禁止心算**：任何出现在报告里的计算，必须有一条对应工具调用的输出。
- **禁止无来源数字**：抓不到就写缺失，标注"待核实"。
- **禁止两面话**：结论必须落在通过/不通过/灰色地带之一；灰色地带要给价格区间与触发条件。
- **禁止用降级通道假装覆盖**：`invest_search` 的 `degraded=true` 必须在报告里显式标注"检索通道降级"。
- **不构成投资建议**：报告结尾固定一句风险提示。

## 输出模板（深度研究与财报精读共用骨架）

```
# <标的> · <类型> · <期间>
## 〇、执行摘要（≤300 字，先给结论）
## 一、核心数据（表格，标明来源与口径）
## 二、本期/本轮最重要的 3 个变化
## 三、生意质量与护城河（巴菲特/芒格视角）
## 四、管理层与资本配置（段永平/李录视角）
## 五、估值与三情景（含折现假设、价格区间）
## 六、反方观点与推翻条件（必填，不许空）
## 七、结论：通过 / 不通过 / 灰色地带
## 八、数据来源与抓取时间（URL + 抓取时间 + 可信度分）
## 九、风险提示（不构成投资建议）
```
