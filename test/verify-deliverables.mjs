// test/verify-deliverables.mjs — 校验 workflow、PDF 管线、工具注册与技能接线
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);

// 1) workflow 脚本与 meta
const wfPath = join(ROOT, 'workflows', 'four-masters.js');
const metaPath = join(ROOT, 'workflows', 'four-masters.meta.json');
if (!existsSync(wfPath)) bad('缺少 workflows/four-masters.js');
if (!existsSync(metaPath)) bad('缺少 workflows/four-masters.meta.json');
const wf = existsSync(wfPath) ? readFileSync(wfPath, 'utf8') : '';
let meta = null;
if (existsSync(metaPath)) {
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err) {
    bad(`four-masters.meta.json 不是合法 JSON：${err.message}`);
  }
}
if (meta) {
  if (meta.name !== 'four-masters-research') bad(`meta.name 应为 four-masters-research，实际 ${meta.name}`);
  if (!Array.isArray(meta.phases) || meta.phases.length !== 6) bad(`meta.phases 应为 6 个，实际 ${meta.phases?.length}`);
  for (const p of meta.phases || []) {
    if (!wf.includes(`phase('${p.title}')`)) bad(`脚本里缺少 phase('${p.title}')`);
  }
  if (!meta.whenToUse || meta.whenToUse.length < 20) bad('meta.whenToUse 缺失或过短');
  else ok(`workflow meta · ${meta.phases.length} 阶段`);
}
if (wf) {
  // 纯脚本：不允许 import/require/Node API
  if (/^\s*(import|export)\s/m.test(wf)) bad('workflow 脚本不应包含 import/export（脚本体内不可用模块系统）');
  if (/\brequire\s*\(|\bprocess\.env\b|\bfs\./m.test(wf)) bad('workflow 脚本引用了 Node API，运行时会报错');
  // 顶层 await 的脚本体：包进 async 函数做语法检查
  try {
    // eslint-disable-next-line no-new-func
    new Function('args', `return (async () => {\n${wf}\n})()`);
    ok('workflow 脚本语法通过（async 包装）');
  } catch (err) {
    bad(`workflow 脚本语法错误：${err.message}`);
  }
  for (const label of ['段永平 · 商业模式', '巴菲特 · 财务估值', '芒格 · 行业竞争', '李录 · 风险与管理层']) {
    if (!wf.includes(label)) bad(`workflow 脚本缺少成员 label：${label}`);
  }
  if (!/parallel\(/.test(wf)) bad('workflow 脚本没有使用 parallel() 起四位大师');
  if (!/pdf\.pages|pages >= 8/.test(wf)) bad('workflow 脚本没有把 PDF 页数作为完成门槛');
  if (!/invest_search/.test(wf) || !/web_search/.test(wf)) bad('workflow prompt 缺少检索降级说明（invest_search → web_search）');
  ok(`workflow 脚本 ${(wf.length / 1024).toFixed(1)}KB`);
}

// 2) 报告管线脚本
const reportScripts = ['palette.py', 'make_charts.py', 'build_report_pdf.py', 'check_pdf.py'];
for (const f of reportScripts) {
  const p = join(ROOT, 'tools', 'report', f);
  if (!existsSync(p)) {
    bad(`缺少 tools/report/${f}`);
    continue;
  }
  const size = statSync(p).size;
  if (size < 1200) bad(`tools/report/${f} 只有 ${size} 字节，疑似未完成`);
  else ok(`tools/report/${f} · ${(size / 1024).toFixed(1)}KB`);
}
if (!existsSync(join(ROOT, 'docs', 'report-pipeline.md'))) bad('缺少 docs/report-pipeline.md（渲染契约）');
else ok('docs/report-pipeline.md');

// 3) 关键技能接线
const mustMention = {
  'skills/investment-team/SKILL.md': [/invest_workflow/, /workflow\(/, /PDF/, /pdf\.pages|PDF 才是|唯一完成判据/],
  'skills/invest/SKILL.md': [/invest_report_pdf/, /PDF/, /invest_workflow/],
  'skills/report-publish/SKILL.md': [/invest_chart/, /invest_report_pdf/, /invest_pdf_check/],
};
for (const [rel, patterns] of Object.entries(mustMention)) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    bad(`缺少 ${rel}`);
    continue;
  }
  const text = readFileSync(p, 'utf8');
  const miss = patterns.filter((re) => !re.test(text));
  if (miss.length) bad(`${rel} 未提到：${miss.map((r) => r.source).join(', ')}`);
  else ok(rel);
}

// 4) 插件注册：10 工具 + 全部技能
const { apply, loadSkills } = await import('../index.js');
const tools = [];
const skills = [];
const ctx = {
  tools: { register: (t) => tools.push(t) },
  inject: (names, fn) => {
    if (!names.includes('skills')) bad(`inject 参数异常：${names}`);
    fn({ skills: { register: (s) => skills.push(s) } });
  },
  logger: () => ({ info() {}, warn() {} }),
};
try {
  apply(ctx, {});
} catch (err) {
  bad(`apply() 抛错：${err.stack || err.message}`);
}
const expectedTools = [
  'invest_search',
  'invest_fetch',
  'invest_audit',
  'invest_verify',
  'invest_rigor',
  'invest_channels',
  'invest_chart',
  'invest_report_pdf',
  'invest_pdf_check',
  'invest_workflow',
];
const got = tools.map((t) => t.name).sort();
for (const t of expectedTools) if (!got.includes(t)) bad(`工具未注册：${t}`);
for (const t of got) if (!expectedTools.includes(t)) bad(`多出未声明工具：${t}`);
ok(`工具注册 ${tools.length} 个`);
const loaded = loadSkills();
if (loaded.length < 23) bad(`技能数 ${loaded.length} < 23（新增 report-publish 后应为 23）`);
else ok(`技能注册 ${loaded.length} 个`);
if (skills.length !== loaded.length) bad(`register 调用 ${skills.length} != loadSkills ${loaded.length}`);

// 5) 工具定义完整性
for (const t of tools) {
  if (!t.description || t.description.length < 30) bad(`工具 ${t.name} 描述过短`);
  if (!t.parameters || t.parameters.type !== 'object') bad(`工具 ${t.name} 缺少 parameters`);
  if (typeof t.execute !== 'function') bad(`工具 ${t.name} 缺少 execute`);
}

console.log(oks.map((m) => `  ok   ${m}`).join('\n'));
if (fails.length) {
  console.log('\n' + fails.map((m) => `  FAIL ${m}`).join('\n'));
  console.log(`\n[FAIL] ${fails.length} 项未通过`);
  process.exit(1);
}
console.log(`\n[PASS] workflow + PDF 管线 + ${tools.length} 工具 / ${loaded.length} 技能`);
