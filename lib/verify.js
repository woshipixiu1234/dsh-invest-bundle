// lib/verify.js — 覆盖率式交叉验证（替代「任一关键词命中即算支持」）
const STOPWORDS = new Set([
  '的', '了', '和', '与', '在', '是', '为', '对', '及', '或', '等', '有', '将', '已',
  '这', '那', '一个', '我们', '他们', '可以', '可能', '因为', '所以', '如果', '以及',
  '但是', '而且', '目前', '今年', '去年', '公司', '这个', '那个', '其中', '同时',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has',
]);

const UNIT_RE =
  /([-+]?\d[\d,]*(?:\.\d+)?)\s*(%|％|亿元|亿|万元|万|千亿|百万|billion|million|bn|mn|bps|倍|美元|港元|港币|人民币|元|股|家|年|季度|q[1-4])?/gi;

export function normalizeNumber(raw) {
  return String(raw).replace(/,/g, '').replace(/％/g, '%');
}

/** 把断言拆成可核对单元：数字（含单位）+ 中文短语 + 英文术语 */
export function claimUnits(claim) {
  const src = String(claim || '');
  const numbers = [];
  let m;
  UNIT_RE.lastIndex = 0;
  while ((m = UNIT_RE.exec(src))) {
    const value = normalizeNumber(m[1]);
    const unit = (m[2] || '').replace('￥', '元');
    if (!m[1]) continue;
    numbers.push({ value, unit, text: `${value}${unit}`.trim() });
    if (numbers.length > 12) break;
  }

  const phrases = [];
  const chunks = src.split(/[，。；、！？,.;!?\n（）()「」【】:：\s]+/);
  for (const chunk of chunks) {
    const c = chunk.replace(/[0-9,.%％+\-]/g, '').trim();
    if (!c) continue;
    // 用连接词再切一层，取 2-12 字的实体片段
    for (const part of c.split(/(?:的|了|和|与|在|是|为|对|及|或|等|有|将|已|而非|但是)/)) {
      const p = part.trim();
      if (p.length < 2 || p.length > 14) continue;
      if (STOPWORDS.has(p)) continue;
      if (!/[\u4e00-\u9fff]/.test(p)) continue;
      if (!phrases.includes(p)) phrases.push(p);
      if (phrases.length > 20) break;
    }
    if (phrases.length > 20) break;
  }

  const latin = [];
  const lre = /[a-zA-Z][a-zA-Z0-9&.\-]{2,}/g;
  let l;
  while ((l = lre.exec(src))) {
    const t = l[0].toLowerCase();
    if (STOPWORDS.has(t)) continue;
    if (!latin.includes(t)) latin.push(t);
  }

  return { claim: src, numbers, phrases, latin };
}

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[。！？；!?;])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

function findExcerpt(text, units) {
  const sents = sentencesOf(text);
  if (!sents.length) return '';
  let best = '';
  let bestScore = -1;
  for (const s of sents) {
    let score = 0;
    for (const n of units.numbers) if (s.includes(n.value)) score += 2;
    for (const p of units.phrases) if (s.includes(p)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore > 0 ? best.slice(0, 220) : '';
}

/** 同一单位下的不同数值 → 疑似冲突（同句或邻近） */
function detectConflicts(units, text) {
  const conflicts = [];
  if (!units.numbers.length) return conflicts;
  const sents = sentencesOf(text);
  for (const n of units.numbers) {
    if (!n.unit) continue;
    const re = new RegExp(`([-+]?\\d[\\d,]*(?:\\.\\d+)?)\\s*${n.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    for (const s of sents) {
      let mm;
      re.lastIndex = 0;
      while ((mm = re.exec(s))) {
        const other = normalizeNumber(mm[1]);
        const a = Number(n.value);
        const b = Number(other);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
        const rel = Math.abs(a - b) / Math.abs(a);
        if (rel > 0.05) {
          conflicts.push({
            claim: n.text,
            found: `${other}${n.unit}`,
            sentence: s.slice(0, 180),
          });
        }
      }
    }
  }
  // 去重
  const seen = new Set();
  return conflicts.filter((c) => {
    const k = `${c.claim}|${c.found}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function scoreAgainstClaim(units, text) {
  const body = String(text || '');
  if (!body.trim()) {
    return { combined: 0, numericCoverage: 0, phraseCoverage: 0, support: false, matchedNumbers: [], matchedPhrases: [], excerpt: '' };
  }
  const matchedNumbers = units.numbers.filter((n) => body.replace(/,/g, '').includes(n.value));
  const matchedPhrases = units.phrases.filter((p) => body.includes(p));
  const matchedLatin = units.latin.filter((t) => body.toLowerCase().includes(t));

  const numericCoverage = units.numbers.length ? matchedNumbers.length / units.numbers.length : 0;
  const phraseCoverage = units.phrases.length ? matchedPhrases.length / units.phrases.length : 0;
  const laxCoverage = units.latin.length ? matchedLatin.length / units.latin.length : 0;

  let combined;
  if (units.numbers.length) combined = numericCoverage * 0.7 + Math.max(phraseCoverage, laxCoverage) * 0.3;
  else combined = Math.max(phraseCoverage, laxCoverage);

  const support =
    combined >= 0.6 && (units.numbers.length === 0 || numericCoverage >= 0.5) && (units.phrases.length === 0 || phraseCoverage >= 0.3);

  return {
    combined: Number(combined.toFixed(2)),
    numericCoverage: Number(numericCoverage.toFixed(2)),
    phraseCoverage: Number(phraseCoverage.toFixed(2)),
    support,
    matchedNumbers: matchedNumbers.map((n) => n.text),
    matchedPhrases: matchedPhrases.slice(0, 8),
    excerpt: findExcerpt(body, units),
  };
}

/**
 * @param {string} claim
 * @param {Array<{url?:string,title?:string,text:string,published?:string}>} sources
 */
export function verifyClaim(claim, sources) {
  const units = claimUnits(claim);
  const details = (sources || []).map((s) => {
    const scored = scoreAgainstClaim(units, s.text);
    const conflicts = detectConflicts(units, s.text);
    return {
      url: s.url || '',
      title: s.title || '',
      ...scored,
      conflicts: conflicts.slice(0, 3),
      conflictCount: conflicts.length,
    };
  });

  const supporting = details.filter((d) => d.support && d.conflictCount === 0);
  const contradicting = details.filter((d) => d.conflictCount > 0);
  let verdict = 'unverified';
  if (supporting.length >= 2) verdict = 'verified';
  else if (supporting.length === 1) verdict = 'weak';
  else if (contradicting.length >= 1) verdict = 'contradicted';

  return {
    claim,
    units: { numbers: units.numbers.map((n) => n.text), phrases: units.phrases, latin: units.latin },
    verdict,
    verdictZh: {
      verified: '✅ 至少 2 个独立来源覆盖（数字与短语同时命中）',
      weak: '⚠️ 仅 1 个来源覆盖',
      contradicted: '❌ 出现数值冲突，先查清哪个数字对',
      unverified: '❌ 无来源达到覆盖阈值',
    }[verdict],
    supportingCount: supporting.length,
    analyzedCount: details.length,
    details: details.sort((a, b) => b.combined - a.combined),
    method:
      '按「数字覆盖率×0.7 + 短语覆盖率×0.3」打分，combined≥0.6 且数字覆盖≥50% 才算支持；同一单位下数值偏差>5% 记为冲突。仍然是启发式，不等于事实核查。',
  };
}
