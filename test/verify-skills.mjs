// test/verify-skills.mjs — 校验 22 个技能的 frontmatter、残留与文件完整性
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills, SKILLS_DIR } from '../index.js';

const dirs = readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory());
let bad = 0;

for (const d of dirs) {
  const p = join(SKILLS_DIR, d, 'SKILL.md');
  const raw = readFileSync(p, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fm) {
    console.log(`[NO-FM] ${d}`);
    bad++;
    continue;
  }
  const keys = fm[1]
    .split(/\r?\n/)
    .filter((l) => /^[a-zA-Z_]+:/.test(l))
    .map((l) => l.split(':')[0].trim());
  const missing = ['name', 'description', 'whenToUse'].filter((k) => !keys.includes(k));
  const residues = [];
  for (const [label, re] of [
    ['$ARGUMENTS', /\$ARGUMENTS/],
    ['TeamCreate', /TeamCreate/],
    ['SendMessage', /SendMessage/],
    ['python3', /python3 tools/],
  ]) {
    if (re.test(raw)) residues.push(label);
  }
  const flag = missing.length || residues.length ? 'FAIL' : 'ok  ';
  if (flag === 'FAIL') bad++;
  console.log(
    `${flag} ${d.padEnd(24)} ${String(raw.length).padStart(6)}ch fm[${keys.join(',')}]${missing.length ? ` miss=${missing}` : ''}${residues.length ? ` residue=${residues}` : ''}`,
  );
}

const skills = loadSkills();
console.log(`\nloadSkills=${skills.length} dirs=${dirs.length} bad=${bad}`);
if (skills.length !== dirs.length || bad) process.exit(1);
console.log('[PASS] all skills valid');
