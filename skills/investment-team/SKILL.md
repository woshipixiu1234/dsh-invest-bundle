---
name: investment-team
description: 四大师并行投研团队：四个真实并行的 Agent（段永平·商业模式 / 巴菲特·财务估值 / 芒格·行业竞争 / 李录·风险与管理层）独立研判，再交叉质证、主笔成稿、图表排版、准出审计，最终交付图文并茂的 PDF。四个成员的进度会显示在会话的 workflow 面板里。
whenToUse: 用户要求对一家上市公司做深度研究、写长篇研报、团队投研、四大师并行分析，或明确要「看到多个 agent 的工作进度」「最后给我 PDF」时使用。单点小问题（一句话估值、某条新闻）不要用本技能，直接用 invest。
---

# 四大师并行投研团队（Workflow 版）

## 为什么走 workflow

- DSH 的 workflow 是原生的多 Agent 编排：**每一次 agent 调用都会在会话的 workflow 面板里生成「运行 → 阶段 → 成员」节点**。四个大师并行时，你会在面板里同时看到四个成员在跑、各自的阶段与结果。
- 用四个 `subagent` 也能并行，但它们不会出现在 workflow 面板，也没有统一的阶段边界和返回值校验——用户明确说了要「在侧边栏看到四个 agent 的工作进度」，所以这里必须用 workflow。
- 注意：顶层 workflow 只能由模型调用 `workflow` 工具发起（插件不能代发起，否则不写会话记录、面板里没有节点）。所以第一步是 `invest_workflow` 取脚本。

## 启动三步（不可跳过）

1. **确认四要素**：`company`（公司简称）、`ticker`（如 `600519.SH`）、`market`（A股/港股/美股）、`asOf`（报告日，默认今天）。缺 ticker 就查代码，不能猜。
2. **取脚本与参数**：`invest_workflow({ company, ticker, market, asOf, outDir?, coverPath?, peers?, wordTarget? })` → 返回 `{ meta, script, args, paths }`，路径已按插件安装位置解析好。
3. **发起 workflow**：`workflow({ meta, script, args })`。
   - `script` 必须**逐字**传递：不要重排缩进、不要删模板字符串、不要改 schema。
   - `meta` 与 `args` 原样传；`args.outDir` 是报告目录（默认 `reports/<公司>-深度研究-<日期>/`）。
   - 前台运行（不开 `run_in_background`），这样面板里能实时看到四个成员的进度。

## 阶段、成员与产出

| 阶段 | 成员 | 产出 | 失败时 |
|---|---|---|---|
| ① 研究简报 | 研究简报 | 标的四要素、最新财报期、3-6 个已核实事实、信息等级 A/B/C、4-5 个核心问题 | 用最小简报继续，之后在报告里标注 |
| ② 四大师并行 | 段永平·商业模式 / 巴菲特·财务估值 / 芒格·行业竞争 / 李录·风险与管理层 | 四份结构化 JSON：verdict / score(1-5) / confidence / thesis / key_findings / evidence / risks / dissent | 某位失败 → 其余继续，主笔标注「该维度缺失」 |
| ③ 交叉质证 | 交叉质证 | 共识、实质冲突（谁对谁、重要性、裁决）、四维评分表、盲点、总判断 | 跳过，正文如实写分歧 |
| ④ 汇总成稿 | 主笔·汇总成稿 | `report.md`（九章，8000-10000 字）+ `report-meta.json` + 5-7 个 `<!-- figure: fN | 主题 | 说明 -->` 占位符 | 整体失败 → 告诉用户断在哪一步 |
| ⑤ 图表与排版 | 排版·图表与 PDF | `charts/spec.json`、5-7 张 PNG、`report.docx`、**`report.pdf`** | 修 spec/正文重跑（最多 3 轮） |
| ⑥ 准出审计 | 准出审计 | `check_pdf` 页数/插图、6 个关键数字抽检、占位符与图片引用检查、`report_audit.py extract` | `pass=false` 时必须修完再交付 |

## 唯一完成判据：PDF

workflow 返回 `ok=true` 且 `pdf.pages >= 8` 且 `pdf.images >= 4`，才算任务完成。

- `.md`、`.docx` 都只是中间产物，**不许当成交付物**；用户要的是图文并茂的 PDF。
- 不达标就修：页数不足 → 正文加长/补表/补图；插图不足 → 在 `charts/spec.json` 补图并替换占位符；渲染报错 → 按 `report-publish` 技能逐级排查引擎。
- 修完重跑 workflow（或直接调 `invest_report_pdf` + `invest_pdf_check`），直到拿到合标的 PDF。

## 向用户汇报的口径

1. 一句话结论 + 投资评级（买入/持有/回避 + 价格区间）。
2. 四维评分表（商业模式 / 财务估值 / 行业竞争 / 风险管理层）。
3. 最关键的 2-3 个分歧（原样保留冲突，不要抹平）。
4. 交付物：PDF 绝对路径 + 页数 + 插图数 + 目录；docx 作为可编辑副本。
5. 数据边界：哪些数字没拿到、哪条通道降级、审计结论（通过/存疑）。

## 降级与兜底

- **workflow 工具不可用**：退化为 4 个 `subagent` 并行 + `invest_chart` / `invest_report_pdf`，并明确告诉用户「本次没有 workflow 面板进度」。
- **检索降级**：`invest_search` 返回 `degraded=true` 或结果无关（如 provider=bing 返回垃圾），立刻改用 `web_search` 找入口，再用 `invest_fetch` / `web_fetch` 抓正文；报告里标注「检索通道降级」。
- **PDF 引擎**：`invest_report_pdf` 的 `engine=auto` 会依次尝试 DSH LibreOffice Kit → soffice → Word COM → Chrome；全失败再排查（见 `report-publish`）。
- **时间越长越要控制**：四大师各自时间盒 8-12 分钟、12 次工具调用；主笔一次成稿，不要反复重写。

## 四位大师的分析清单（workflow 已内置，改动时保持一致）

- **段永平 · 商业模式**：这是不是一门好生意？生意本质拆解、客户价值、护城河逐项验证、定价权、本分与不为清单、10 年后还在不在。
- **巴菲特 · 财务估值**：价格是否明显低于价值？5-10 年现金流质量、ROE/ROIC 杜邦拆解、资产负债表、股东回报、PE/PB/自由现金流收益率与历史分位、三情景目标价、安全边际。
- **芒格 · 行业竞争**：反过来想，它会怎么死？行业周期与需求、竞争格局与对手进攻点、5 种死亡情景与领先指标、产业链议价、替代品、反共识检查。
- **李录 · 风险与管理层**：十年后的确定性有多高？管理层诚信与资本配置、治理结构、监管政策、长期确定性、红线清单、文明级趋势。

四位的结论**允许冲突**：冲突本身是信息，交叉质证要把冲突写清楚，主笔不许和稀泥。

## 质量底线

- 每个关键数字必须有来源（URL 或「公告名 + 日期」）并标 as_of；两源交叉，误差 >1% 标记。
- 所有计算走 `invest_rigor`（`financial_rigor.py`），禁止心算。
- 不编造数据；查不到写「未获取」并降低 confidence。
- 结论明确，禁止两面话；风险提示固定结尾。
- 报告正文严格使用 `docs/report-pipeline.md` §4 的 Markdown 子集，否则 PDF 会丢内容。

## 数据源优先级

A股：巨潮 `site:cninfo.com.cn`、上交所/深交所、公司公告 PDF 原文 → 东方财富/同花顺数据页 → 财新/证券时报等媒体。
港股：披露易 `site:hkexnews.hk` → 公司 IR → 券商报告。美股：SEC EDGAR（10-K/10-Q/8-K）→ IR → 电话会纪要。

## 署名

本技能 fork 自 [ai-berkshire](https://github.com/xbtlin/ai-berkshire)（MIT License，commit 70646dd3aed80a7398fb293cc2b2a4de30d6070c），四大师框架与评分体系沿用上游，Workflow 编排、PDF 渲染管线与工具链由 dsh-invest-bundle 改写。
