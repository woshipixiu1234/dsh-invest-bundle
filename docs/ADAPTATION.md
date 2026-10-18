# ai-berkshire → DeepSeek Harness 技能改造说明

本包把 [xbtlin/ai-berkshire](https://github.com/xbtlin/ai-berkshire) 的 21 个 Claude Code skill
机械改造成 DSH 原生技能（`skills/<slug>/SKILL.md`），并原样收录 `tools/` 下的 Python 工具。

| 项 | 值 |
|----|----|
| 源仓库 | `xbtlin/ai-berkshire`（分支 `main`） |
| 源 commit | `70646dd3aed80a7398fb293cc2b2a4de30d6070c` |
| 抓取开始 / 完成 | 2026-10-18 21:02:38 +0800 / 2026-10-18 21:02:39 +0800 |
| 源 skill 数 | 21（`skills/*.md`） |
| 源 tools | 13 个（`tools/*`，另跳过 `xkcd.woff` 字体文件；清单中的 `star-test` 不存在） |
| 改造后总字节 | 293099 |
| 替换项总数 | 264 |
| 生成脚本 | [`docs/adapt_skills.py`](adapt_skills.py)（可重跑，源文件有本地缓存） |

> 改造只做机械替换：**不新增、不删除任何方法论内容**，正文逐字保留；
> 45KB 的 `private-company-research` 全文完整保留，未做任何截断。

## 一、逐文件改造统计

| slug | 原字节 | 改造后字节 | 原行数 | 改造后行数 | 替换项 | 主要替换项 |
|------|-------:|----------:|------:|----------:|------:|-----------|
| `bottleneck-hunter` | 18640 | 20206 | 476 | 494 | 11 | WebSearch→web_search×4, $ARGUMENTS×1, DSH frontmatter×1 |
| `deep-company-series` | 14419 | 16122 | 245 | 263 | 15 | 斜杠命令→技能×5, 本Skill→本技能×4, $ARGUMENTS×1 |
| `dyp-ask` | 8434 | 9852 | 186 | 204 | 2 | DSH frontmatter×1, 第〇步联网预检×1 |
| `earnings-review` | 8853 | 10601 | 218 | 236 | 16 | python3→python + 路径分隔符×5, skills/*.md×2, tools路径分隔符×2 |
| `earnings-team` | 16677 | 18475 | 444 | 462 | 20 | python3→python + 路径分隔符×6, Agent工具×3, 斜杠命令→技能×3 |
| `era-alpha` | 6490 | 8125 | 96 | 114 | 4 | $ARGUMENTS×1, DSH frontmatter×1, Agent工具×1 |
| `financial-data` | 7328 | 8814 | 152 | 170 | 12 | python3→python + 路径分隔符×6, tools路径分隔符×3, DSH frontmatter×1 |
| `income-investment` | 10525 | 12151 | 187 | 205 | 10 | python3→python + 路径分隔符×3, $ARGUMENTS×1, DSH frontmatter×1 |
| `industry-funnel` | 10099 | 11631 | 305 | 323 | 9 | 斜杠命令→技能×3, python3→python + 路径分隔符×2, $ARGUMENTS×1 |
| `industry-research` | 9272 | 10945 | 268 | 286 | 8 | python3→python + 路径分隔符×2, $ARGUMENTS×1, DSH frontmatter×1 |
| `investment-checklist` | 9732 | 11394 | 239 | 257 | 8 | $ARGUMENTS×2, python3→python + 路径分隔符×2, DSH frontmatter×1 |
| `investment-research` | 16357 | 18092 | 314 | 332 | 21 | python3→python + 路径分隔符×10, skills/*.md×2, tools路径分隔符×2 |
| `investment-team` | 11074 | 13686 | 229 | 244 | 34 | python3→python + 路径分隔符×6, 角色短语×4, WebSearch→web_search×3 |
| `management-deep-dive` | 10332 | 12028 | 282 | 300 | 9 | 本Skill→本技能×2, $ARGUMENTS×1, DSH frontmatter×1 |
| `news-pulse` | 12020 | 14255 | 234 | 246 | 26 | 斜杠命令→技能×6, $ARGUMENTS×2, CLAUDE.md→AGENTS.md×2 |
| `portfolio-review` | 7218 | 8850 | 190 | 208 | 9 | 斜杠命令→技能×2, tools路径分隔符×2, $ARGUMENTS×1 |
| `private-company-research` | 45287 | 47485 | 1071 | 1090 | 13 | 角色短语×2, $ARGUMENTS×1, DSH frontmatter×1 |
| `quality-screen` | 7171 | 8697 | 168 | 186 | 5 | $ARGUMENTS×1, DSH frontmatter×1, Agent工具×1 |
| `thesis-drift` | 9379 | 10999 | 210 | 228 | 17 | python3→python + 路径分隔符×5, 斜杠命令→技能×4, $ARGUMENTS×2 |
| `thesis-tracker` | 7733 | 9257 | 210 | 228 | 8 | 斜杠命令→技能×2, WebSearch→web_search×2, $ARGUMENTS×1 |
| `wechat-article` | 9811 | 11434 | 231 | 249 | 7 | Agent工具×3, $ARGUMENTS×1, DSH frontmatter×1 |
| **合计** | **256851** | **293099** | **5955** | **6325** | **264** | |

### tools/（原样拷贝，字节完全一致）

| 文件 | 字节 |
|------|-----:|
| `tools/ashare_data.py` | 12845 |
| `tools/financial_rigor.py` | 17844 |
| `tools/log-command.sh` | 1049 |
| `tools/momentum_backtest.py` | 15926 |
| `tools/momentum_backtest_v2.py` | 17754 |
| `tools/morningstar_fair_value.py` | 5587 |
| `tools/report_audit.py` | 22091 |
| `tools/reports_index.py` | 17137 |
| `tools/star_history_chart.py` | 14952 |
| `tools/stock_screener.py` | 13647 |
| `tools/terminal_value.py` | 29242 |
| `tools/twstock_data.py` | 15495 |
| `tools/xueqiu_scraper.py` | 17167 |

## 二、7 类机械替换的 before / after

### C1 顶部补 DSH frontmatter（`name` / `description` / `whenToUse`）

原文只有 `news-pulse` 带 Claude 风格 frontmatter，其余 20 个无 frontmatter。

```yaml
# before（news-pulse.md 原文，无 whenToUse，且描述含未转义冒号）
---
name: news-pulse
description: 公司新闻脉搏：股价异动时快速归因。用 4 个并行 Agent 侦察公司事件/监管政策/行业对手/市场情绪，产出"事件时间线 + 异动主因判断 + 是否触发论文重审"。
---

# after（21 个文件统一为三键；description 使用全角冒号，YAML 安全）
---
name: news-pulse
description: 公司新闻脉搏：股价异动时快速归因，4 个并行 Agent 侦察公司事件/监管政策/行业对手/市场情绪，产出事件时间线与异动主因判断。
whenToUse: 新闻归因, 股价异动, 大涨大跌, 事件侦察, 新闻脉搏, 异动归因
---
```

### C2 `$ARGUMENTS` → 标的占位

```diff
- 对 $ARGUMENTS 进行财报精读分析。
+ 对 用户本轮指定的标的（从对话上下文取；缺失就先反问，不要编造） 进行财报精读分析。
```

### C3 多 Agent：Task / TeamCreate / TaskCreate / SendMessage → DSH subagent

```diff
- 使用 Task 工具启动多个后台 Agent **并行**获取以下原始材料：
+ 使用 DSH `subagent` 工具，在**同一条消息**中并发发起多个 subagent 调用，并行获取以下原始材料
+ （子 agent 之间不共享上下文，返回摘要即止；需要汇总哪些内容就在提示词里写清）：

- 使用 TeamCreate 创建团队：
- - team_name: `{公司名}-research`（英文小写，如 `meituan-research`）
- - agent_type: `team-lead`
+ 使用 DSH `subagent` 工具组建并行研究小组（DSH 没有常驻 team 对象；团队名只作为报告标题与目录命名约定保留；
+ 子 agent 之间不共享上下文，返回摘要即止）：
+ - group_name: `{公司名}-research`（英文小写，如 `meituan-research`）
+ - 协调者: 你（相当于原 team-lead，负责统筹、汇总、输出最终报告）
```

角色划分、任务编号与每个角色负责的维度、并行/串行顺序、阶段产物文件名（如
`reports/{公司名}/{公司名}-earnings-{期间}.md`）全部保持不变。

### C4 `python3 tools/xxx.py` → `python tools\xxx.py`

```diff
- python3 tools/financial_rigor.py cross-validate \
-   --metric "revenue" --values 108.3e9 107.9e9 --sources "公司财报" "Yahoo Finance"
+ python tools\financial_rigor.py cross-validate \
+   --metric "revenue" --values 108.3e9 107.9e9 --sources "公司财报" "Yahoo Finance" --tolerance 1.0
```

`bash` 代码围栏保留（其中的 python 命令在 pwsh 下可直接运行）；仅
`deep-company-series` 里一处纯 Unix 的 `grep -r ... | head` 改成等价 pwsh
`Get-ChildItem ... | Select-String ... | Select-Object -First 20`。

### C5 每个 SKILL.md 的「第〇步：联网可用性预检」（原 issue #58 红线）

```markdown
## 第〇步：联网可用性预检

**本步骤先于一切取数与分析，不可跳过。**

1. 确认本轮会话中 `web_search` 与 `web_fetch` 工具**实际可用**：先用一次无害的检索探针验证调用能真实返回结果。
2. 若任一工具不可用、调用被拦截或无返回，**立即停止**，明确告知用户：**「本轮无联网能力，无法产出可信研报」**……
3. **禁止凭记忆编造数据**：……原项目 issue #58 的失败模式正是检索被静默拦截后仍输出完整研报——宁可中止，不可伪装。
4. 引用来源必须是**本轮实际抓取到的 URL**……
5. 每份报告末尾必须有**「数据来源与抓取时间」**表……
```

插入位置按各文件结构固定：有 `## 执行流程` 的插在标题后，以 `## 第一步` / `## 阶段一` 开头的插在首个步骤前
（逐文件锚点见 `adapt_skills.py` 的 `ANCHORS`）。

### C6 误差阈值统一 1%（原文 1% vs 工具默认 2.0 的矛盾）

```diff
- 每个关键数据必须来自两个独立来源，误差>1%须标记。
+ 每个关键数据必须来自两个独立来源，误差>1%须标记（对应 `--tolerance 1.0`）。

- python3 tools/financial_rigor.py cross-validate --field {字段} --values '{JSON}' --unit {单位}
+ python tools\financial_rigor.py cross-validate --field {字段} --values '{JSON}' --unit {单位} --tolerance 1.0
```

已核实 `tools/financial_rigor.py` 的 `--tolerance` 默认值为 2.0，与 skill 文本的 1% 不一致；
改造后**全部 5 处 `cross-validate` 命令都显式传 `--tolerance 1.0`**，工具本体保持上游原样未改。

### C7 报告落盘路径统一到当前工作区 `reports/`

```diff
- 将完整最终报告写入 `~/{公司名}投资研究报告_{日期}.md`（日期格式 YYYYMMDD）。
+ 将完整最终报告写入 `reports/{公司名}投资研究报告_{日期}.md`（日期格式 YYYYMMDD）。

- 命令示例：`... --output /tmp/dyp-{公司名}.md`
+ 命令示例：`... --output $env:TEMP\dyp-{公司名}.md`
```

原文已经写 `reports/` 的保持不变；4 处 `~/` 输出路径改为 `reports/`，2 处 `/tmp/` 改为 `$env:TEMP\`。

## 三、附加可移植性修补（C8，不涉及方法论）

| 原文（Claude Code 生态） | 改造后（DSH 生态） | 说明 |
|--------------------------|--------------------|------|
| `WebSearch` / `WebFetch` | `web_search` / `web_fetch` | 工具名对齐 DSH |
| `Bash` 工具 | `pwsh` 工具 | DSH 在 Windows 上的命令执行工具 |
| `/investment-team` 等斜杠命令 | `investment-team 技能` | DSH 技能按名称调用，无自定义 slash 命令 |
| `skills/financial-data.md` | `skills/financial-data/SKILL.md` | 指向本包真实路径 |
| `CLAUDE.md` 客观性原则 | `AGENTS.md` 客观性原则 | DSH 的项目规范文件名 |
| `本 Skill` | `本技能` | 术语统一 |
| `TeamCreate` / `TaskCreate` / `TaskUpdate` / `TeamDelete` / `SendMessage` / `shutdown_request` | 并发 `subagent` + 返回值摘要 | DSH 无这些工具 |
| `subagent_type: general-purpose` / `run_in_background: true` | 提示词自包含 + 同一条消息并发 | DSH subagent 无这些参数 |
| `Explore agent` | `subagent` | DSH 只有一种子 agent |
| `permissions.allow` 白名单预检（investment-team） | 实际调用一次检索探针 | DSH 无该白名单机制 |

## 四、已知无法改造 / 需人工注意的点

1. **`permissions.allow` 白名单机制在 DSH 不存在。** 原文 `investment-team` 第一步¾ 让模型 grep
   `.claude/settings.local.json` 确认 `WebSearch` 被放行，DSH 没有这层白名单（工具可用性由会话/插件授权决定）。
   改造后该节改为「按第〇步实际调用一次检索探针」，保留原失败模式说明与 issue #58 引用。
2. **`TeamCreate` / `TaskCreate` / `TaskUpdate` / `TeamDelete` / `SendMessage` / `shutdown_request` 在 DSH 无对应物。**
   DSH 的 subagent 是一次性、无共享上下文的调用，返回摘要即结束。原文的 team/任务看板/成员间消息通信
   改为「同一条消息并发 subagent + 提示词写清要汇总的字段」。因此原文里「Agent 之间通过 SendMessage 协作」
   的实时进度展示能力弱化为「按返回顺序汇总」——这是工具能力差异，不是方法论改动。
3. **`run_in_background: true` 无对应参数。** DSH subagent 默认同步并发；原文里「后台 Agent 无法弹出交互式确认」
   的困境在 DSH 中同样存在（subagent 不能向用户确认），所以第〇步的探针必须在**发起 subagent 之前**由主 agent 完成。
4. **`/income-investment "<company>" [mode=...]` 这类命令式调用**在 DSH 中是「把参数写进对话」。
   原文的用法行保留为说明文本，调用时由用户自然语言给出标的与模式。
5. **`wechat-article` 依赖 poppler 的 `pdftoppm` / `pdftotext` 把论文 PDF 渲成 PNG**，Windows 默认没有
   这些命令，需要自行安装 Poppler（或改用其它 PDF 转图工具）。命令里的输出目录已从 `/tmp/` 改为 `$env:TEMP\`。
6. **`tools/xueqiu_scraper.py`** 抓雪球需要网络与 cookie，原文未给凭据管理方案，本包未做改动（原样拷贝）。
7. **`tools/` 未改一行代码**，包括 `financial_rigor.py` 的 `--tolerance` 默认值 2.0；
   冲突按「skill 文本显式传 `--tolerance 1.0`」解决，避免上游工具行为漂移，便于日后同步上游。
8. **源仓库的 `CLAUDE.md`、`.claude/` 配置、`commands/` 等 Claude Code 专属资产未收录**；
   本包只收录 `skills/*.md` 与 `tools/*`。
9. **`dyp-ask` 是人格扮演类 skill**，没有取数流程；第〇步预检只在其需要联网核实事实/最新言论时生效，
   不改变其「不懂就说不懂」的红线。
10. **报告目录 `reports/` 需存在**：DSH 的 write 工具会自动建目录；若用 Python 工具写盘，脚本自行处理。

## 五、交付前自检结果

由 `adapt_skills.py` 在生成时逐文件执行，全部通过才写盘：

- 21 个 `skills/<slug>/SKILL.md` 全部生成；
- 逐个解析 frontmatter（不依赖 pyyaml），`name` / `description` / `whenToUse` 三键齐全，
  `description` / `whenToUse` 中无 YAML 不安全的 `\": "` 与 tab；
- 每个文件 `## 第〇步：联网可用性预检` 恰好 1 次；
- 全文 grep 无残留：`$ARGUMENTS`、`TeamCreate`、`TaskCreate`、`TaskUpdate`、`TeamDelete`、
  `SendMessage`、`shutdown_request`、`python3 tools`、`subagent_type`、`run_in_background`、
  `general-purpose`、`Explore agent`、`.claude`、`CLAUDE.md`、`permissions.allow`。

## 六、署名尾注（发布合规，生成后单独维护）

`adapt_skills.py` 只负责把上游 skill 改造成 DSH 版本；署名尾注由**独立脚本**
`scripts/add-attribution.mjs` 追加，幂等、可重复运行：

```bash
node scripts/add-attribution.mjs            # 给 21 个改造技能追加尾注（已存在则跳过）
node scripts/add-attribution.mjs --dry-run  # 只看会改哪些文件
```

尾注固定为「改造自 ai-berkshire（MIT, Copyright (c) 2026 xbtlin，提交 70646dd3…）+ 上游地址 + 指向 NOTICE.md」，
目的是让**单独拷走一份 SKILL.md** 的使用者也能看到来源与许可，而不必依赖包根声明。
重新生成技能后请再跑一次本脚本，并用 `node test/license-check.mjs` 验证（会断言 21 个技能都带尾注）。
