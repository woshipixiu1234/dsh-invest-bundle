#!/usr/bin/env node
/**
 * pack-check.mjs — 验收发布产物（不联网、不需要 npm 登录）。
 *
 * 做的事：
 *   1) npm pack 到临时目录，解析 --json 输出的文件清单；
 *   2) 断言必需文件齐全、技能 22 个、脚本 13 个、体积合理、无本机绝对路径泄漏；
 *   3) 把 tarball 解包到临时目录，import 解包后的 index.js，验证导出形状（name/inject/apply）；
 *   4) 用假 ctx 对解包后的副本再跑一次注册，确认注册 6 个工具 + 22 个技能。
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'dsh-invest-pack-'));
const fails = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) fails.push(label);
};

// ---- 1. npm pack ----
const raw = execSync(`npm pack --json --pack-destination "${work}"`, {
  cwd: root,
  encoding: 'utf8',
});
const packInfo = JSON.parse(raw.slice(raw.indexOf('[')))[0];
const tarball = join(work, packInfo.filename);
const files = packInfo.files.map((f) => f.path.replace(/\\/g, '/'));
const sizeKb = Math.round(packInfo.size / 1024);

check(existsSync(tarball), 'npm pack 生成 tarball', `${packInfo.filename} · ${sizeKb} KB`);
check(sizeKb > 60 && sizeKb < 2048, 'tarball 体积合理', `${sizeKb} KB`);

// ---- 2. 文件清单 ----
const required = [
  'package.json',
  'index.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'docs/ADAPTATION.md',
  'docs/HARVEST-CHANNELS.md',
];
const missing = required.filter((p) => !files.includes(p));
check(missing.length === 0, '必需文件齐全', missing.length ? `缺 ${missing.join(', ')}` : '8/8');

const libFiles = files.filter((p) => p.startsWith('lib/') && p.endsWith('.js'));
check(libFiles.length === 7, 'lib/*.js 打包完整', `${libFiles.length}/7`);

const skillFiles = files.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p));
check(skillFiles.length === 22, '技能 SKILL.md 数量', `${skillFiles.length}/22`);

const pyTools = files.filter((p) => /^tools\/[^/]+\.py$/.test(p));
const shTools = files.filter((p) => /^tools\/[^/]+\.sh$/.test(p));
check(pyTools.length === 12 && shTools.length === 1, 'tools 脚本数量（12 .py + 1 .sh）', `${pyTools.length} + ${shTools.length}`);

const notices = [
  files.includes('NOTICE.md'),
  files.includes('LICENSE'),
  files.includes('tools/UPSTREAM-NOTICE.md'),
  files.includes('skills/UPSTREAM-NOTICE.md'),
];
check(notices.every(Boolean), '协议声明随包分发（4 个文件）', notices.filter(Boolean).length + '/4');

const testLeak = files.filter((p) => p.startsWith('test/') || p.startsWith('scripts/') || p.startsWith('.git'));
check(testLeak.length === 0, '开发文件未进包（test/scripts/.git）', testLeak.join(', ') || 'none');

// package.json 内的绝对路径泄漏
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pkgText = JSON.stringify(pkg);
// 只认「引号/冒号后紧跟盘符」的形态，避免把 https: 误判成本机路径
check(!/["'\s(][A-Za-z]:[\\/]/.test(pkgText), 'package.json 无本机绝对路径');
check(!!pkg.dsh?.bundle?.patch, 'manifest: dsh.bundle.patch', pkg.dsh?.bundle?.patch);
check(pkg.private !== true, 'manifest: 未标记 private（可发布）');
check(!!pkg.repository?.url, 'manifest: repository 已填', pkg.repository?.url);
if (/OWNER/.test(pkgText)) {
  console.log('WARN  manifest: repository 仍是 OWNER 占位符 — 发布前跑 `node scripts/set-owner.mjs <你的 GitHub 用户名>`');
}

// ---- 3. cordis.patch.yml ----
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
check(/- insert:/.test(patch), 'cordis.patch.yml 含 insert');
check(
  new RegExp(`name:\\s*['"]?${pkg.name}['"]?`).test(patch),
  'cordis.patch.yml 的 name 等于包名',
  pkg.name,
);

// ---- 4. 解包 + import + 注册 ----
const unpack = join(work, 'unpacked');
mkdirSync(unpack, { recursive: true });
execSync(`tar -xzf "${tarball}" -C "${unpack}"`, { cwd: work });
const pkgDir = join(unpack, 'package');
const mod = await import(pathToFileURL(join(pkgDir, 'index.js')).href);
check(typeof mod.apply === 'function', '解包后 import 成功：apply 是函数');
check(mod.name === pkg.name, 'export const name 与包名一致', mod.name);
check(Array.isArray(mod.inject) && mod.inject.includes('tools'), 'export const inject 含 tools');

const registered = [];
const skills = [];
const ctx = {
  logger: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
  get: () => undefined,
  inject(_deps, cb) {
    cb({ skills: { register: (skill) => skills.push(skill) } });
  },
  tools: { register: (tool) => registered.push(tool) },
};
await mod.apply(ctx, {});
check(registered.length === 6, '解包副本注册工具数', `${registered.length}/6`);
check(skills.length === 22, '解包副本注册技能数', `${skills.length}/22`);
check(
  registered.every((t) => t.name && t.description && t.parameters && typeof t.execute === 'function'),
  '每个工具都有 name/description/parameters/execute',
);
check(
  skills.every((s) => s.name && s.content && s.invocation?.modelInvocable),
  '每个技能都有 name/content/modelInvocable',
);

// ---- 汇总 ----
console.log('');
if (fails.length) {
  console.log(`FAILED: ${fails.length} 项 — ${fails.join(' | ')}`);
  console.log(`产物目录: ${work}`);
  process.exit(1);
}
console.log(`ALL PASS · 发布产物验收通过 · ${sizeKb} KB · ${files.length} 个文件 · 产物: ${tarball}`);
writeFileSync(join(root, '..', '.last-pack.txt'), `${tarball}\n`, 'utf8');
