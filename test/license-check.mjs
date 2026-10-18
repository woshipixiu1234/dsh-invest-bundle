#!/usr/bin/env node
/**
 * license-check.mjs — 开源协议合规验收
 *
 * 默认只做离线结构性检查；加 --remote 会去 GitHub 拉上游原文逐字节比对：
 *   node test/license-check.mjs --remote
 *
 * 检查项：
 *   1) LICENSE 是 MIT，且带本包版权行；
 *   2) NOTICE.md 含上游 MIT 全文、上游版权行、固定提交号、逐目录署名说明；
 *   3) skills/ 与 tools/ 各自带 UPSTREAM-NOTICE.md（拷贝走也能带走声明）；
 *   4) package.json 的 files[] 覆盖 LICENSE/NOTICE/ADAPTATION 与两个目录；
 *   5) 包内 .js/.py 不出现其他协议声明（GPL/Apache/BSD/MPL）；
 *   6) --remote：13 个 tools/* 与上游逐字节相同；21 个技能与上游不同（确为改造，非原样复制）。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv.includes('--remote');
const UPSTREAM = 'xbtlin/ai-berkshire';
const COMMIT = '70646dd3aed80a7398fb293cc2b2a4de30d6070c';
const RAW = `https://raw.githubusercontent.com/${UPSTREAM}/${COMMIT}`;

const fails = [];
const warns = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) fails.push(label);
};

const read = (p) => readFile(join(root, p), 'utf8');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- 1. LICENSE ----
const license = await read('LICENSE');
check(/^MIT License/m.test(license), 'LICENSE 为 MIT');
check(/Copyright \(c\) 2026 \S/.test(license), 'LICENSE 带本包版权行');
check(license.includes('Permission is hereby granted, free of charge'), 'LICENSE 含 MIT 授权正文');
check(!/GPL|Apache License|BSD 3-Clause/.test(license), 'LICENSE 未混入其他协议');

// ---- 2. NOTICE ----
const notice = await read('NOTICE.md');
check(notice.includes('MIT License'), 'NOTICE 含上游 MIT 全文标题');
check(notice.includes('Copyright (c) 2026 xbtlin'), 'NOTICE 保留上游版权行');
check(notice.includes(COMMIT), 'NOTICE 固定上游提交号');
check(notice.includes('https://github.com/xbtlin/ai-berkshire'), 'NOTICE 给出上游仓库地址');
check(notice.includes('原样复制') && notice.includes('逐字节相同'), 'NOTICE 说明 tools 为原样复制');
check(notice.includes('改造') && notice.includes('skills/invest/SKILL.md'), 'NOTICE 说明技能为改造 + 原创部分');
check(notice.includes('playwright') || notice.includes('外部依赖'), 'NOTICE 说明运行期外部依赖不随包分发');

// ---- 3. 逐目录署名 ----
for (const dir of ['skills', 'tools']) {
  const p = join(root, dir, 'UPSTREAM-NOTICE.md');
  const ok = await stat(p).then(() => true, () => false);
  check(ok, `${dir}/UPSTREAM-NOTICE.md 存在`);
  if (ok) {
    const text = await readFile(p, 'utf8');
    check(text.includes('Copyright (c) 2026 xbtlin') && text.includes(COMMIT), `${dir}/UPSTREAM-NOTICE.md 含版权行与提交号`);
    check(text.includes('NOTICE.md'), `${dir}/UPSTREAM-NOTICE.md 指向包根声明`);
  }
}

// ---- 4. 打包覆盖 ----
const pkg = JSON.parse(await read('package.json'));
const files = pkg.files || [];
check(files.includes('NOTICE.md'), 'files[] 含 NOTICE.md');
check(files.includes('docs/ADAPTATION.md'), 'files[] 含 docs/ADAPTATION.md');
check(files.includes('skills') && files.includes('tools'), 'files[] 含 skills 与 tools（署名文件随之打包）');
check(pkg.license === 'MIT', 'package.json license = MIT', pkg.license);

// ---- 5. 其他协议声明 ----
const scan = async (dir) => {
  const out = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await scan(rel)));
    else if (/\.(js|mjs|py|sh)$/.test(e.name)) out.push(rel);
  }
  return out;
};
const codeFiles = [...(await scan('lib')), ...(await scan('tools')), 'index.js'];
const foreign = [];
for (const f of codeFiles) {
  const text = await readFile(join(root, f), 'utf8');
  const m = text.match(/(GPL-?\d?|Apache License|BSD-3-Clause|BSD-2-Clause|MPL-2\.0)/);
  if (m) foreign.push(`${f}:${m[0]}`);
}
check(foreign.length === 0, '包内代码无其他协议声明', foreign.join(', ') || `${codeFiles.length} 个文件已扫`);

// ---- 5.5 每个改造技能末尾的署名尾注（离线，scripts/add-attribution.mjs 维护）----
const derivedDirs = (await readdir(join(root, 'skills'), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && e.name !== 'invest')
  .map((e) => e.name)
  .sort();
const noFooter = [];
const badFooter = [];
for (const d of derivedDirs) {
  const text = await readFile(join(root, 'skills', d, 'SKILL.md'), 'utf8');
  const tail = text.slice(-1200);
  if (!tail.includes('改造自 ai-berkshire')) {
    noFooter.push(d);
    continue;
  }
  const okTail =
    tail.includes('https://github.com/xbtlin/ai-berkshire') &&
    tail.includes('Copyright (c) 2026 xbtlin') &&
    tail.includes(COMMIT) &&
    tail.includes('NOTICE.md');
  if (!okTail) badFooter.push(d);
}
check(noFooter.length === 0, '改造技能都带署名尾注', noFooter.join(', ') || `${derivedDirs.length} 个`);
check(badFooter.length === 0, '尾注含上游仓库/版权行/提交号/指向 NOTICE.md', badFooter.join(', ') || 'ok');
const investSkill = await readFile(join(root, 'skills', 'invest', 'SKILL.md'), 'utf8');
check(!investSkill.includes('改造自 ai-berkshire'), 'skills/invest 未被误标为改造版');

// ---- 6. 与上游逐字节比对（需网络）----
if (remote) {
  const getUpstream = async (p) => {
    const res = await fetch(`${RAW}/${p}`);
    if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };

  const toolFiles = (await readdir(join(root, 'tools'))).filter((f) => /\.(py|sh)$/.test(f)).sort();
  check(toolFiles.length === 13, 'tools 脚本数 = 13', `${toolFiles.length}`);
  const same = [];
  const differ = [];
  for (const f of toolFiles) {
    const local = await readFile(join(root, 'tools', f));
    try {
      const up = await getUpstream(`tools/${f}`);
      if (sha(local) === sha(up)) same.push(f);
      else differ.push(`${f}(本地 ${local.length}B / 上游 ${up.length}B)`);
    } catch (err) {
      warns.push(`上游读取失败 ${f}: ${err.message}`);
    }
  }
  check(same.length === toolFiles.length, '13 个脚本与上游逐字节相同', `${same.length}/${toolFiles.length}`);
  if (differ.length) console.log(`      差异: ${differ.join(', ')}`);

  const skillDirs = (await readdir(join(root, 'skills'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  check(skillDirs.length === 22, '技能目录数 = 22', `${skillDirs.length}`);
  const adapted = [];
  const identical = [];
  const missingUpstream = [];
  for (const d of skillDirs) {
    if (d === 'invest') continue; // 本包原创
    const local = await readFile(join(root, 'skills', d, 'SKILL.md'));
    try {
      const up = await getUpstream(`skills/${d}.md`);
      if (sha(local) === sha(up)) identical.push(d);
      else adapted.push(d);
    } catch {
      missingUpstream.push(d);
    }
  }
  check(adapted.length === 21, '21 个技能确为改造版（与上游不同）', `${adapted.length}/21`);
  check(identical.length === 0, '无技能与原样上游文件混淆', identical.join(', ') || 'none');
  if (missingUpstream.length) warns.push(`上游未找到对应文件: ${missingUpstream.join(', ')}`);
}

// ---- 汇总 ----
console.log('');
if (warns.length) {
  console.log('WARN:');
  for (const w of warns) console.log(`  - ${w}`);
}
if (fails.length) {
  console.log(`FAILED: ${fails.length} 项 — ${fails.join(' | ')}`);
  process.exit(1);
}
console.log(`ALL PASS · 协议合规验收通过${remote ? '（含上游逐字节比对）' : '（离线）'}`);
