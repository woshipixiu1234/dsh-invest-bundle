# dsh-invest-bundle

把 **价值投资研究能力** 装进 DeepSeek Harness 的捆绑插件：22 个投研技能 + 6 个原生工具 + 12 个 Python 投研脚本，零外部 npm 依赖。

- 方法论血统：[xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire)（MIT，16.8k★）的 21 个 Claude Code 技能，已改造为 DSH 原生技能
- 通道设计：吸收 [@stifer/dsh-harvest](https://github.com/toustifer/dsh-harvest) 的多平台调研思路，但把「关键词命中」式验证换成覆盖率式验证
- 所有脚本来自 ai-berkshire 的 `tools/`，原样保留（Decimal 精确计算、准出审核、终值推演）

## 它解决什么问题

普通 LLM 写研报的通病：没有一手资料、数字靠心算、结论模棱两可、无法复核。这个包用三层约束堵住：

1. **取数层**：`invest_search` 多路降级检索 + `invest_fetch` 直抓/降级 r.jina.ai，拿到正文才算数
2. **方法层**：22 个技能强制 SOP（信息丰富度 A/B/C 分级、8 条否决红线、强制结论、准出/打回闸门）
3. **数值层**：`invest_rigor` 跑 Python 工具做市值验算、交叉验证、三情景、Benford 造假检测、十年 IRR 审计

## 安装

上架后的标准装法：在「插件 → 发现」里搜索本插件点安装——市场条目会把 `target` 与 `registry`
交给 `plugin_manager.install_bundle` 完成安装（本包声明了 `dsh.bundle.patch`，因此可安装）。

本地开发/未上架时的装法：

```jsonc
// C:\Users\woshi\.dsh\profiles\desktop\package.json
"dependencies": {
  "dsh-invest-bundle": "link:D:/DSH-Workspaces/06-金融学习与skill转插件/packages/dsh-invest-bundle"
},
"dsh": { "profile": { "bundles": [ ..., "dsh-invest-bundle" ] } }
```

改完 `pnpm install` 后**重启 DSH 桌面端**（bundle 启动树只在启动时读取）。源码改动无需重装，因为 link 指向工作区，重启即生效。

发布到 DSH 插件市场的完整流程见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 6 个原生工具

| 工具 | 作用 | 关键行为 |
|---|---|---|
| `invest_channels` | 通道健康度体检 | 13 行状态表（11 条 harvest 通道 + 自身检索/抓取），状态 `ok/degraded/missing/needs-key/needs-login` |
| `invest_search` | 联网检索 | 降级链 Tavily → Exa → DuckDuckGo → DDG-Lite → Bing；返回 `degraded` 标记，全失败时明令「不得编造」 |
| `invest_fetch` | 抓正文 | 直抓 → 挑战页检测 → 升级 `r.jina.ai`；标记 `paywall` / `unreachable` |
| `invest_audit` | 来源可信度 | 读**正文**的五维打分（权威性/一手性/可验证/时效/偏见，0-20 分），阈值 17 可信 / 11 谨慎 |
| `invest_verify` | 断言交叉验证 | 数字覆盖率×0.7 + 短语覆盖率×0.3；同一指标两源偏差 >5% 记冲突；≥2 源支持且无冲突才 `verified` |
| `invest_rigor` | 跑 Python 投研工具 | 白名单 9 个脚本，`execFile` 无 shell，参数长度与字符校验，`PYTHONUTF8=1` |

### 与 harvest 的验证差异（重要）

`harvest_verify` 的实现是「任一关键词命中即算该来源支持该论断」，一个「腾讯」就能让几十个来源全部计票，两票即 `verified`——假阳性极高。`invest_verify` 要求数字覆盖率和短语覆盖率同时达标，并把数值冲突单独判为 `contradicted`。

`harvest_audit` 只看 URL 和来源类型猜权威性，不读正文。`invest_audit` 读正文，按数字密度、一手标记、时效、标题党词打分。

## 22 个技能

总控 `invest`（10 步流水线 + 联网预检 + 硬性底线），其余 21 个来自 ai-berkshire，按用途分组：

- **深度研究**：`investment-research`（8 步 + 三情景 + 十年折现审计）、`investment-team`（四角色并行）、`management-deep-dive`、`private-company-research`、`deep-company-series`
- **财报**：`earnings-review`（一手资料精读 8 步）、`earnings-team`（6 Agent 三阶段）
- **行业与筛选**：`industry-research`、`industry-funnel`（4 层漏斗）、`quality-screen`（7 条去劣）、`bottleneck-hunter`、`era-alpha`、`investment-checklist`
- **持仓与跟踪**：`portfolio-review`、`thesis-tracker`、`thesis-drift`、`news-pulse`、`income-investment`
- **工具与杂项**：`financial-data`（分市场取数规范）、`dyp-ask`（段永平式提问）、`wechat-article`

## 12 个 Python 脚本

`financial_rigor.py`（6 子命令：市值验算/估值验算/交叉验证/Benford/精算/三情景）、`terminal_value.py`（终值倍数与十年 IRR，含 C1/C2/C3 三条硬约束审计）、`report_audit.py`（报告数据抽检 15% + 准出/打回判决）、`reports_index.py`、`stock_screener.py`、`ashare_data.py`、`twstock_data.py`（FinMind）、`xueqiu_scraper.py`（需 playwright）、`morningstar_fair_value.py`、`momentum_backtest.py` / `_v2.py`、`star_history_chart.py`。

全部零第三方依赖（仅 stdlib，`xueqiu_scraper.py` 除外），Python 3.10+ 可跑。
其中 `star_history_chart.py` 依赖上游两个因许可原因未随包分发的资产（xkcd 字体为 CC BY-NC），
仅作参考保留、也不在 `invest_rigor` 执行白名单内——详见 [NOTICE.md](NOTICE.md) 第 3.1 节。

## 自检

```powershell
cd packages\dsh-invest-bundle
node test\verify-skills.mjs   # 22 个技能 frontmatter 与残留检查
node test\register.mjs        # 假 ctx 验证 6 工具 + 技能注册
node test\smoke.mjs           # 检索/抓取/审计/验证/脚本 全链路
node test\tools-check.mjs     # 逐个工具真实调用
node test\pack-check.mjs      # 发布产物验收（npm pack → 解包 → import → 注册）
```

## 许可与署名

- 本包代码：MIT（[LICENSE](LICENSE)）。
- 21 个技能文本改造自 [xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire)（MIT, © 2026 xbtlin），
  固定提交 `70646dd3aed80a7398fb293cc2b2a4de30d6070c`；`tools/` 下 12 个 `.py` 与 1 个 `.sh` 为**原样复制、未修改**。
- 声明分两级放置：包根 `LICENSE` + [NOTICE.md](NOTICE.md)（含上游 MIT 全文），
  以及 `skills/UPSTREAM-NOTICE.md`、`tools/UPSTREAM-NOTICE.md`（子目录单独分发时也不丢署名）。
- 改造范围与逐项改动见 [docs/ADAPTATION.md](docs/ADAPTATION.md)；第 22 个技能 `invest`
  与本包 `index.js`/`lib/` 全部代码为原创。
- 可复核的合规验收：`node test\license-check.mjs --remote`（与上游逐字节比对：13/13 相同、21/21 不同）。

## 需要你配置的东西

检索与抓取**无需任何 Key** 即可用（Bing 兜底）。想要更好质量与稳定性，见 [docs/HARVEST-CHANNELS.md](docs/HARVEST-CHANNELS.md)：Tavily / Exa 的 Key、harvest 各平台通道的安装与登录状态。

## 免责

本包是研究流程工具，不构成投资建议。所有评分均为启发式，不能替代对原始报表、公告与合同的核对。
