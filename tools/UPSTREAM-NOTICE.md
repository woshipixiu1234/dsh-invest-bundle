本目录下的 `*.py` 与 `*.sh` 全部来自 ai-berkshire 仓库，**原样复制、未做任何修改**：

- 上游：https://github.com/xbtlin/ai-berkshire （`tools/` 目录）
- 提交：`70646dd3aed80a7398fb293cc2b2a4de30d6070c`
- 许可：MIT License，Copyright (c) 2026 xbtlin

MIT 许可要求「在软件的所有副本或主要部分中保留上述版权声明与许可声明」，
因此本目录随包分发时，请与包根的 `LICENSE`、`NOTICE.md`（含上游 MIT 全文）一起保留。
若你把 `tools/` 单独拷到别处使用，请一并带走这两个文件。

本文件（`UPSTREAM-NOTICE.md`）由本包新增，不属于上游内容。

注意：上游 `tools/` 里的两个二进制资产（`xkcd.woff` 字体为 CC BY-NC、`star-history-logo.png`
授权不明）**未**随包分发，因此 `star_history_chart.py` 缺资产无法直接运行，仅作参考保留；
该脚本也不在 `invest_rigor` 的执行白名单内。详见包根 `NOTICE.md` 第 3.1 节。
