// test/smoke.mjs — 本地冒烟测试：不依赖 DSH 运行时
import { search, searchProviderStatus } from '../lib/search.js';
import { fetchPage } from '../lib/fetch-page.js';
import { auditSources } from '../lib/audit.js';
import { verifyClaim } from '../lib/verify.js';
import { checkPython, runFinanceTool } from '../lib/rigor.js';
import { probeChannels } from '../lib/channels.js';
import { loadSkills } from '../index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeCtx = { get: () => null };

const line = (t) => console.log(`\n===== ${t} =====`);
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`[PASS] ${name}`);
    return r;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e && e.stack ? e.stack.split('\n')[0] : e}`);
    return null;
  }
};

line('python');
const py = await checkPython({});
console.log(py);

line('skills');
const skills = loadSkills();
console.log(`loaded ${skills.length}:`, skills.map((s) => s.name).join(', '));

line('providers');
console.log(await searchProviderStatus(fakeCtx));

line('search (ddg fallback)');
const r1 = await step('search', () => search(fakeCtx, '腾讯 2025 年度业绩 营收', { limit: 3 }));
console.log(JSON.stringify({ ok: r1?.ok, provider: r1?.provider, count: r1?.count, warnings: r1?.warnings, first: r1?.results?.[0] }, null, 2));

line('fetch');
const f1 = await step('fetch', () => fetchPage('https://www.tencent.com/zh-cn/investors.html', { maxChars: 600 }));
console.log(JSON.stringify({ ok: f1?.ok, via: f1?.via, status: f1?.status, chars: f1?.chars, title: f1?.title, head: f1?.text?.slice(0, 120) }, null, 2));

line('audit');
const a = auditSources([
  { url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', title: '10-K', text: '本 10-K 年度报告披露营收 123.4 亿美元，同比增长 12.3%，2025 年 1 月 31 日发布。'.repeat(3), published: '2026-01-31' },
  { url: 'https://xueqiu.com/123/456', title: '十倍牛股必涨', text: '这个票必涨翻倍，闭眼买，目标价 100 元，稳赚不赔。', published: '' },
]);
console.log(JSON.stringify({ summary: a.summary, scores: a.sources.map((s) => [s.host, s.score, s.verdict]) }, null, 2));

line('verify');
const v = verifyClaim('腾讯 2025 年营收 7000 亿元，同比增长 12%', [
  { url: 'https://a.example/1', title: '支持源', text: '腾讯 2025 年营收 7000 亿元，同比增长 12%，业绩稳健。' },
  { url: 'https://b.example/2', title: '同义表述', text: '根据财报，腾讯 2025 年营收为 7000 亿元，同比增速 12%。' },
  { url: 'https://c.example/3', title: '冲突源', text: '腾讯 2025 年营收 6200 亿元，同比增长 3%。' },
  { url: 'https://d.example/4', title: '无关源', text: '今天天气不错，适合出去散步。' },
]);
console.log(JSON.stringify({ verdict: v.verdict, support: v.supportingCount, details: v.details.map((d) => [d.title, d.combined, d.support, d.conflictCount]) }, null, 2));

line('rigor');
const rig = await runFinanceTool({ script: 'financial_rigor.py', args: [] }, { toolsDir: path.join(ROOT, 'tools') });
console.log(JSON.stringify({ ok: rig.ok, exitCode: rig.exitCode, stderr: (rig.stderr || '').slice(0, 200), hint: rig.hint }, null, 2));

line('channels');
const ch = await probeChannels(fakeCtx);
console.log(JSON.stringify(ch.summary, null, 2));
console.log(ch.rows.map((r) => `${r.channel}: ${r.status}`).join(' | '));
