#!/usr/bin/env node
/**
 * set-owner.mjs — 把包元数据里的 OWNER 占位符替换成真实的 GitHub 账号，
 * 并生成 awesome-dsh-plugin 的投稿文件（data/plugins/<owner>__<repo>.yml 的内容）。
 *
 * 用法：
 *   node scripts/set-owner.mjs <github-owner> [repo-name]
 *
 * 例：
 *   node scripts/set-owner.mjs woshi dsh-invest-bundle
 *
 * 无第三方依赖；只改 package.json 的 repository/homepage/bugs/author 与
 * docs/awesome-dsh-plugin-entry.yml。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [owner, repoArg] = process.argv.slice(2);

if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
  console.error('用法: node scripts/set-owner.mjs <github-owner> [repo-name]');
  console.error('  github-owner 只能含字母、数字与连字符（GitHub 账号规则）');
  process.exit(1);
}
const repo = repoArg || 'dsh-invest-bundle';
if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
  console.error(`仓库名不合法: ${repo}`);
  process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const url = `https://github.com/${owner}/${repo}`;

pkg.repository = { type: 'git', url: `git+${url}.git` };
pkg.homepage = `${url}#readme`;
pkg.bugs = { url: `${url}/issues` };
if (pkg.author === 'dsh-invest-bundle contributors') pkg.author = owner;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const entryPath = join(root, 'docs', 'awesome-dsh-plugin-entry.yml');
const entry = `url: ${url}
name: ${owner}/${repo}
category: skill
description:
  en: Investment research pipeline with 6 tools (search, page fetch, source audit, claim verification, numeric rigor, channel health) and 22 skills: 21 adapted from ai-berkshire plus one orchestration skill.
  zh: 投研流水线：6 个工具（检索、正文抓取、来源审计、断言核验、数值严谨、通道体检），外加 22 个技能（21 个改造自 ai-berkshire，1 个总控编排技能）。
`;
await writeFile(entryPath, entry, 'utf8');

console.log(`package.json → ${url}`);
console.log(`投稿文件 → docs/awesome-dsh-plugin-entry.yml`);
console.log('');
console.log('下一步（需要你自己登录）：');
console.log(`  1. git remote add origin ${url}.git`);
console.log('  2. gh auth login && gh repo create --source . --public --push \\');
console.log(`       --description "DSH investment research bundle: 6 tools + 22 skills"`);
console.log('  3. gh repo edit --add-topic dsh-plugin');
console.log('  4. npm login && npm publish');
console.log('  5. 复制 docs/awesome-dsh-plugin-entry.yml 到 awesome-dsh-plugin 仓库的');
console.log(`     data/plugins/${owner}__${repo}.yml 后开 PR`);
