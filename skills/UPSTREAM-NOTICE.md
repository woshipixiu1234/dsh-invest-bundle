本目录下的 21 个技能（除 `invest/` 外）改造自 ai-berkshire 的 `skills/*.md`：

- 上游：https://github.com/xbtlin/ai-berkshire （`skills/` 目录）
- 提交：`70646dd3aed80a7398fb293cc2b2a4de30d6070c`
- 许可：MIT License，Copyright (c) 2026 xbtlin

改造内容（详见包根 `docs/ADAPTATION.md` 与 `NOTICE.md`）：宿主指令从 Claude Code 换为 DSH、
新增第〇步联网可用性预检、参数占位符改写、`financial_rigor.py cross-validate` 示例与
`--tolerance` 口径修正；其余正文、表格与结论保持上游原文。

`invest/` 是本包原创（DSH 侧总控流水线），不属于上游内容。

MIT 许可要求「在软件的所有副本或主要部分中保留上述版权声明与许可声明」，
因此本目录随包分发时，请与包根的 `LICENSE`、`NOTICE.md`（含上游 MIT 全文）一起保留。
