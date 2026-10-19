# dsh-invest-bundle

[![verify](https://github.com/woshipixiu1234/dsh-invest-bundle/actions/workflows/verify.yml/badge.svg)](https://github.com/woshipixiu1234/dsh-invest-bundle/actions/workflows/verify.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

把 **价值投资研究能力** 装进 DeepSeek Harness 的捆绑插件：23 个投研技能 + 10 个原生工具 + 四大师并行 workflow + 图文并茂 PDF 渲染管线，零外部 npm 依赖。

- 方法论血统：[xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire)（MIT，16.8k★）的 21 个 Claude Code 技能，已改造为 DSH 原生技能
- 通道设计：吸收 [@stifer/dsh-harvest](https://github.com/toustifer/dsh-harvest) 的多平台调研思路，但把「关键词命中」式验证换成覆盖率式验证
- 所有脚本来自 ai-berkshire 的 `tools/`，原样保留（Decimal 精确计算、准出审核、终值推演）

## 它解决什么问题

普通 LLM 写研报的通病：没有一手资料、数字靠心算、结论模棱两可、无法复核。这个包用四层约束堵住：

1. **取数层**：`invest_search` 多路降级检索 + `invest_fetch` 直抓/降级 r.jina.ai，拿到正文才算数
2. **方法层**：23 个技能强制 SOP（信息丰富度 A/B/C 分级、8 条否决红线、强制结论、准出/打回闸门）
3. **数值层**：`invest_rigor` 跑 Python 工具做市值验算、交叉验证、三情景、Benford 造假检测、十年 IRR 审计
4. **交付层**：四大师并行 workflow（`invest_workflow` → `workflow` 工具，四个真实 Agent 的进度显示在会话面板）→ `invest_chart` 出图 → `invest_report_pdf` 出 PDF → `invest_pdf_check` 准出。**PDF 是交付物，md 只是过程稿**

## 安装

在 DSH 桌面端的「插件 → 发现」里搜索 `dsh-invest-bundle` 安装，重启后生效。

也可以用 Git 目标直接安装：

```
https://github.com/woshipixiu1234/dsh-invest-bundle
# 或 release 附件里的 dsh-invest-bundle.tgz
```

从源码开发时，把仓库放到本地，在 profile 的 `package.json` 里用 `link:` 指向仓库目录，并加入 `dsh.profile.bundles`，`pnpm install` 后重启桌面端：

```jsonc
"dependencies": {
  "dsh-invest-bundle": "link:/path/to/dsh-invest-bundle"
},
"dsh": { "profile": { "bundles": [ ..., "dsh-invest-bundle" ] } }
```

源码改动无需重装：bundle 启动树只在启动时读取，重启即生效。

## 快速开始

对模型说一句：「用 investment-team 研究贵州茅台 600519.SH，报告日 2026-10-20」。

它会先调 `invest_workflow` 拿脚本与参数，再用 `workflow` 起四个并行 Agent（进度在会话面板里可见），
交叉质证后由主笔写成 `report.md`，`invest_chart` 出图，`invest_report_pdf` 渲染成 PDF，
最后 `invest_pdf_check` 校验页数与插图数。产物在 `reports/<公司>-深度研究-<日期>/report.pdf`。

只想做单点任务时不必上 workflow：直接说「看一下这家公司的财报」或「筛一遍白酒行业」，
对应的 `earnings-review` / `industry-funnel` 等技能会被按需调用。

## 10 个原生工具

| 工具 | 作用 | 关键行为 |
|---|---|---|
| `invest_channels` | 通道健康度体检 | 13 行状态表（11 条 harvest 通道 + 自身检索/抓取），状态 `ok/degraded/missing/needs-key/needs-login` |
| `invest_search` | 联网检索 | 降级链 Tavily → Exa → DuckDuckGo → DDG-Lite → Bing；返回 `degraded` 标记，全失败时明令「不得编造」 |
| `invest_fetch` | 抓正文 | 直抓 → 挑战页检测 → 升级 `r.jina.ai`；标记 `paywall` / `unreachable` |
| `invest_audit` | 来源可信度 | 读**正文**的五维打分（权威性/一手性/可验证/时效/偏见，0-20 分），阈值 17 可信 / 11 谨慎 |
| `invest_verify` | 断言交叉验证 | 数字覆盖率×0.7 + 短语覆盖率×0.3；同一指标两源偏差 >5% 记冲突；≥2 源支持且无冲突才 `verified` |
| `invest_rigor` | 跑 Python 投研工具 | 白名单 9 个脚本，`execFile` 无 shell，参数长度与字符校验，`PYTHONUTF8=1` |
| `invest_workflow` | 装载四大师 workflow | 返回 `{meta, script, args, paths}`：6 阶段、四个真实并行成员；脚本与参数原样传给 `workflow` 工具 |
| `invest_chart` | spec 驱动出图 | 13 种图表类型，统一配色/标题/来源脚注，PNG 落 `<outDir>/charts/`，dpi 200 |
| `invest_report_pdf` | Markdown→图文 PDF | 封面/结论框/表格/图注/页脚 PAGE 域；引擎自动降级 LibreOffice Kit → soffice → Word COM → Chrome |
| `invest_pdf_check` | PDF 准出检查 | 页数/内嵌插图/文本量，可渲染前 N 页 PNG；门槛 `pages>=8 && images>=4` |

### 与 harvest 的验证差异（重要）

`harvest_verify` 的实现是「任一关键词命中即算该来源支持该论断」，一个「腾讯」就能让几十个来源全部计票，两票即 `verified`——假阳性极高。`invest_verify` 要求数字覆盖率和短语覆盖率同时达标，并把数值冲突单独判为 `contradicted`。

`harvest_audit` 只看 URL 和来源类型猜权威性，不读正文。`invest_audit` 读正文，按数字密度、一手标记、时效、标题党词打分。

## 23 个技能

总控 `invest`（11 步流水线 + 联网预检 + 硬性底线 + PDF 交付），深度研究走 `investment-team`（四大师 workflow），成稿排版走 `report-publish`，其余 20 个来自 ai-berkshire，按用途分组：

- **深度研究**：`investment-research`（8 步 + 三情景 + 十年折现审计）、`investment-team`（四大师并行 workflow，交付 PDF）、`management-deep-dive`、`private-company-research`、`deep-company-series`
- **财报**：`earnings-review`（一手资料精读 8 步）、`earnings-team`（6 Agent 三阶段）
- **行业与筛选**：`industry-research`、`industry-funnel`（4 层漏斗）、`quality-screen`（7 条去劣）、`bottleneck-hunter`、`era-alpha`、`investment-checklist`
- **持仓与跟踪**：`portfolio-review`、`thesis-tracker`、`thesis-drift`、`news-pulse`、`income-investment`
- **工具与杂项**：`financial-data`（分市场取数规范）、`dyp-ask`（段永平式提问）、`wechat-article`、`report-publish`（图表/PDF 排版与准出）

## 四大师并行 workflow

`investment-team` 技能的标准动作是三步：

1. `invest_workflow({ company, ticker, market, asOf })` 拿到脚本、meta 与预填参数（路径已按安装位置解析）
2. `workflow({ meta, script, args })` 发起运行——**四个真实 Agent 并行**：段永平·商业模式 / 巴菲特·财务估值 / 芒格·行业竞争 / 李录·风险与管理层
3. 依次经过交叉质证、主笔成稿、图表排版、准出审计；最终产物是 `<outDir>/report.pdf`（≥8 页、≥4 图）

六个阶段都会出现在会话的 workflow 面板里，可展开看每个成员的实时状态与返回值。完成判据只有一个：`ok=true && pdf.pages>=8 && images>=4`；md/docx 只是中间产物。

渲染契约见 [docs/report-pipeline.md](docs/report-pipeline.md)：Markdown 子集、`report-meta.json` 字段、图表 spec（13 种类型）、引擎降级链与质量门槛。

## 12 个 Python 脚本

`financial_rigor.py`（6 子命令：市值验算/估值验算/交叉验证/Benford/精算/三情景）、`terminal_value.py`（终值倍数与十年 IRR，含 C1/C2/C3 三条硬约束审计）、`report_audit.py`（报告数据抽检 15% + 准出/打回判决）、`reports_index.py`、`stock_screener.py`、`ashare_data.py`、`twstock_data.py`（FinMind）、`xueqiu_scraper.py`（需 playwright）、`morningstar_fair_value.py`、`momentum_backtest.py` / `_v2.py`、`star_history_chart.py`。

全部零第三方依赖（仅 stdlib，`xueqiu_scraper.py` 除外），Python 3.10+ 可跑。
其中 `star_history_chart.py` 依赖上游两个因许可原因未随包分发的资产（xkcd 字体为 CC BY-NC），
仅作参考保留、也不在 `invest_rigor` 执行白名单内——详见 [NOTICE.md](NOTICE.md) 第 3.1 节。

### 报告渲染管线（新增）

`tools/report/` 是原创渲染管线，只依赖 `python-docx` + `matplotlib` + 标准库：

| 文件 | 作用 |
|---|---|
| `palette.py` | 唯一视觉 token：NAVY/AMBER/BLUE… 配色、字体、matplotlib 主题、`save_fig()` |
| `make_charts.py` | `--spec spec.json --out-dir charts/ [--json]`，13 种图表类型，统一标题/脚注/配色 |
| `build_report_pdf.py` | `--md report.md --out-dir . --meta report-meta.json [--engine auto] [--json]`，输出 docx + pdf |
| `check_pdf.py` | `--pdf report.pdf [--json] [--render-pages 3]`，页数/插图/文本量/渲染目检 |

## 自检

```powershell
cd packages\dsh-invest-bundle
node test\verify-skills.mjs       # 23 个技能 frontmatter 与残留检查
node test\verify-deliverables.mjs # workflow 脚本 + PDF 管线 + 10 工具 / 23 技能注册
node test\register.mjs            # 假 ctx 验证工具 + 技能注册
node test\smoke.mjs               # 检索/抓取/审计/验证/脚本 全链路
node test\tools-check.mjs         # 逐个工具真实调用
node test\pack-check.mjs          # 打包产物验收（npm pack → 解包 → import → 注册）
```

`verify-deliverables.mjs` 会检查：workflow 脚本语法（async 包装）、6 个 `phase()` 与 meta 一致、四个成员 label、PDF 完成门槛、
`tools/report/*.py` 是否完整、关键技能是否接线到新工具、以及 `apply()` 实际注册的 10 个工具与 23 个技能。

## 许可与署名

- 本包代码：MIT（[LICENSE](LICENSE)）。
- 21 个技能文本改造自 [xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire)（MIT, © 2026 xbtlin），
  固定提交 `70646dd3aed80a7398fb293cc2b2a4de30d6070c`；`tools/` 下 12 个 `.py` 与 1 个 `.sh` 为**原样复制、未修改**。
- 声明分两级放置：包根 `LICENSE` + [NOTICE.md](NOTICE.md)（含上游 MIT 全文），
  以及 `skills/UPSTREAM-NOTICE.md`、`tools/UPSTREAM-NOTICE.md`（子目录单独分发时也不丢署名）。
- 改造范围与逐项改动见 [docs/ADAPTATION.md](docs/ADAPTATION.md)；第 22 个技能 `invest`、第 23 个技能 `report-publish`、
  `workflows/`、`tools/report/` 与本包 `index.js`/`lib/` 全部代码为原创。
- 可复核的合规验收：`node test\license-check.mjs --remote`（与上游逐字节比对：13/13 相同、21/21 不同）。

## 需要你配置的东西

检索与抓取**无需任何 Key** 即可用（Bing 兜底）。想要更好质量与稳定性，见 [docs/HARVEST-CHANNELS.md](docs/HARVEST-CHANNELS.md)：Tavily / Exa 的 Key、harvest 各平台通道的安装与登录状态。

## 免责

本包是研究流程工具，不构成投资建议。所有评分均为启发式，不能替代对原始报表、公告与合同的核对。
