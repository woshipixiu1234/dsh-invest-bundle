#!/usr/bin/env node
/**
 * add-attribution.mjs — 给 21 个改造自 ai-berkshire 的技能追加署名尾注（幂等）。
 *
 * 目的：MIT 只要求「副本或主要部分里保留版权与许可声明」。包根已有 LICENSE + NOTICE.md，
 * 但技能是纯文本、最容易被单独拷走，所以在每个技能文件末尾再留一行来源，降低声明丢失的风险。
 *
 * 用法：
 *   node scripts/add-attribution.mjs            # 写入
 *   node scripts/add-attribution.mjs --dry-run  # 只看会改什么
 *
 * 不改 `skills/invest`（本包原创）。已带尾注的文件跳过，可重复运行。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const SKIP = new Set(['invest']);
const MARKER = '改造自 ai-berkshire';
const FOOTER = `
---

> 本技能${MARKER}（MIT License, Copyright (c) 2026 xbtlin，
> 提交 70646dd3aed80a7398fb293cc2b2a4de30d6070c），已改造为 DSH 原生技能。
> 上游：https://github.com/xbtlin/ai-berkshire · 署名与许可全文见本包 \`NOTICE.md\`。
`;

const dirs = (await readdir(join(root, 'skills'), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && !SKIP.has(e.name))
  .map((e) => e.name)
  .sort();

let added = 0;
let skipped = 0;
for (const dir of dirs) {
  const file = join(root, 'skills', dir, 'SKILL.md');
  const text = await readFile(file, 'utf8');
  if (text.includes(MARKER)) {
    skipped += 1;
    continue;
  }
  if (dryRun) {
    console.log(`[dry] ${dir}`);
    added += 1;
    continue;
  }
  await writeFile(file, `${text.replace(/\s*$/, '')}\n${FOOTER}`, 'utf8');
  console.log(`[added] ${dir}`);
  added += 1;
}
console.log(`\n${dryRun ? '将追加' : '已追加'}=${added} · 已存在=${skipped} · 总计=${dirs.length}`);
