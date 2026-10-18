# NOTICE — 第三方来源与许可

本包（`dsh-invest-bundle`）自身代码以 MIT 许可发布（见 LICENSE）。其中包含以下第三方成果，
按各自许可保留署名与许可声明。

## 1. ai-berkshire（主要来源）

- 仓库：https://github.com/xbtlin/ai-berkshire
- 许可：MIT License，Copyright (c) 2026 xbtlin
- 固定提交：`70646dd3aed80a7398fb293cc2b2a4de30d6070c`
- 许可全文：见本文件末尾「附录 A」。

### 1.1 技能文本（改造自上游，非原样复制）

`skills/` 下以下 21 个技能目录的文字内容改造自上游 `skills/*.md`：

`bottleneck-hunter`、`deep-company-series`、`dyp-ask`、`earnings-review`、`earnings-team`、
`era-alpha`、`financial-data`、`income-investment`、`industry-funnel`、`industry-research`、
`investment-checklist`、`investment-research`、`investment-team`、`management-deep-dive`、
`news-pulse`、`portfolio-review`、`private-company-research`、`quality-screen`、
`thesis-drift`、`thesis-tracker`、`wechat-article`

改造内容（`docs/ADAPTATION.md` 有逐项记录，改动脚本 `docs/adapt_skills.py` 可重跑）：

- 宿主指令替换：Claude Code 专属的 `TeamCreate` / `TaskCreate` / `SendMessage` / `subagent_type` /
  `.claude/settings.local.json` / `permissions.allow` 等，改写为 DSH 的 `subagent` / `agent` 并行调用方式；
- 新增每个技能的第〇步「联网可用性预检」，调用本包 `invest_channels`，通道不可用即明确告知而不编造；
- `$ARGUMENTS` 等占位符改写为 DSH 的参数约定；
- 数值口径修正：`financial_rigor.py cross-validate` 的示例改为真实参数签名 `--field … --values '{…}'`，
  `--tolerance` 统一为 1.0（与技能文本「误差 >1% 须标记」一致）；
- 其余篇幅、表格行数、案例与结论均保持上游原文。

### 1.2 Python 工具（原样复制，未修改）

`tools/` 下 13 个文件与上游 `tools/` 逐字节相同（共 200,736 字节）：

`ashare_data.py`、`financial_rigor.py`、`log-command.sh`、`momentum_backtest.py`、
`momentum_backtest_v2.py`、`morningstar_fair_value.py`、`report_audit.py`、`reports_index.py`、
`star_history_chart.py`、`stock_screener.py`、`terminal_value.py`、`twstock_data.py`、
`xueqiu_scraper.py`

（`tools/UPSTREAM-NOTICE.md` 与 `skills/UPSTREAM-NOTICE.md` 是本包新增的署名文件，
不属于上游内容，因此不在上面的 13 个之列。）

### 1.3 声明位置（拷贝到别处也不会丢）

| 文件 | 作用 |
| --- | --- |
| `LICENSE` | 本包 MIT 全文 |
| `NOTICE.md` | 本文件：来源、改造范围、上游 MIT 全文 |
| `skills/UPSTREAM-NOTICE.md` | 技能目录内的署名（带走 21 个技能时请一并带走） |
| `tools/UPSTREAM-NOTICE.md` | 脚本目录内的署名（带走脚本时请一并带走） |
| 21 个改造技能的末尾尾注 | 单独拷走某个 `skills/<名字>/SKILL.md` 时仍保留来源（由 `scripts/add-attribution.mjs` 维护） |

MIT 的要求是「保留版权声明与许可声明」，本包在包级与目录级各放了一份；
若你要把某个子目录单独分发，请至少保留该目录的 `UPSTREAM-NOTICE.md` 与包根的
`LICENSE`、`NOTICE.md`。

### 1.3 本包原创部分

- `index.js`、`lib/` 下全部代码（6 个工具：`invest_search` / `invest_fetch` / `invest_audit` /
  `invest_verify` / `invest_rigor` / `invest_channels`）；
- `skills/invest/SKILL.md`（第 22 个技能，DSH 侧总控流水线）；
- `test/`、`docs/`。

## 2. 通道探测的参考对象

`lib/channels.js` 的通道清单（GitHub / YouTube / V2EX / Telegram / LinkedIn / B 站等）与
「失败不阻塞、逐行报告状态」的策略，参考了插件 `@stifer/dsh-harvest` 的行为设计；
代码为独立实现，未复制其源码。

## 3. 运行期外部依赖（不随包分发）

`tools/` 中的脚本会按需访问外部站点或调用外部命令行工具，这些依赖不包含在本包内，
其许可与条款由各自提供方决定：macrotrends、Morningstar、FinMind、雪球，以及
`gh`、`yt-dlp`、`mcporter`、`opencli`、`bili` 等 CLI。

其中唯一需要额外安装的 Python 库是 `xueqiu_scraper.py` 用到的
[Playwright](https://github.com/microsoft/playwright-python)（Apache-2.0，未随包分发）；
其余 10 个 `.py` 只用标准库。缺库时 `invest_rigor` 会明确报「No module named playwright」并给出提示，
不会静默失败。

### 3.1 有意未随包分发的上游资产

上游 `tools/` 里还有两个二进制资产，**没有**复制进本包：

| 上游文件 | 未收录原因 |
| --- | --- |
| `tools/xkcd.woff` | xkcd 手写字体为 **CC BY-NC**（禁止商业使用），与本包的 MIT 许可冲突 |
| `tools/star-history-logo.png` | 第三方项目标识，授权未明确到可再分发 |

因此 `star_history_chart.py` 虽然与上游逐字节相同，但缺这两个资产无法直接运行——
它没有进 `invest_rigor` 的执行白名单（白名单只含 9 个脚本），仅作参考保留。
其余 12 个脚本（11 个 `.py` + `log-command.sh`）可直接运行。

## 4. 合规如何验证（可复核）

```powershell
cd packages\dsh-invest-bundle
node test\license-check.mjs            # 离线：声明齐全、无其他协议混入、打包覆盖
node test\license-check.mjs --remote   # 联网：与上游逐字节比对
```

`--remote` 会用固定提交号 `70646dd3aed80a7398fb293cc2b2a4de30d6070c` 拉取上游原文并算 SHA-256，
本包当前结果：**13/13 个脚本与上游完全相同，21/21 个技能与上游不同（确为改造版），
`skills/invest` 无上游对应文件（原创）**。任何人可对同一提交重跑这条命令复核。

---

## 附录 A — ai-berkshire 的 MIT 许可全文

```
MIT License

Copyright (c) 2026 xbtlin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
