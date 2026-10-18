// test/e2e-demo.mjs — 真实跑一遍流水线：检索 → 抓取 → 审计 → 交叉验证
import { search, searchProviderStatus } from '../lib/search.js';
import { fetchMany } from '../lib/fetch-page.js';
import { scoreSource } from '../lib/audit.js';
import { verifyClaim } from '../lib/verify.js';

const ctx = { get: () => null };
const q = process.argv[2] || '宁德时代 2025 年 年报 净利润';

console.log('provider status:', JSON.stringify(await searchProviderStatus(ctx)));
const s = await search(ctx, q, { limit: 5 });
console.log(`\n[search] provider=${s.provider} degraded=${s.degraded} count=${s.count}`);
for (const r of s.results) console.log(`  - ${r.title.slice(0, 60)} | ${r.url}`);

const urls = s.results.slice(0, 3).map((r) => r.url);
const f = await fetchMany(ctx, urls, { max: 3 });
console.log(`\n[fetch] stats=${JSON.stringify(f.stats)}`);

const audited = [];
for (const r of f.results) {
  if (!r.ok) {
    console.log(`  × ${r.url} → ${r.error}`);
    continue;
  }
  const a = scoreSource({ url: r.url, title: r.title, text: r.text });
  audited.push({ ...r, a });
  console.log(`  ✓ ${r.url.slice(0, 70)} ${r.viaJina ? '[jina]' : '[direct]'} ${r.text.length}ch → ${a.score}/20 ${a.verdict}`);
  console.log(`     维度: ${Object.entries(a.dims).map(([k, v]) => `${k}=${v.score}`).join(' ')}`);
}

const claim = process.argv[3] || '宁德时代 2025 年净利润超过 500 亿元';
const v = verifyClaim(
  claim,
  audited.map((r) => ({ url: r.url, title: r.title, text: r.text })),
);
console.log(`\n[verify] claim="${claim}"`);
console.log(`  verdict=${v.verdict} (${v.verdictZh})`);
console.log(`  supporting=${v.supportingCount}/${v.analyzedCount}`);
console.log(`  method=${v.method}`);
for (const s of v.details) {
  const tag = s.support && s.conflictCount === 0 ? '支持' : s.conflictCount > 0 ? '冲突' : '未覆盖';
  console.log(
    `  - ${tag.padEnd(4)} combined=${s.combined.toFixed(2)} numeric=${s.numericCoverage.toFixed(2)} phrase=${s.phraseCoverage.toFixed(2)} conflicts=${s.conflictCount} ${s.url.slice(0, 56)}`,
  );
}
