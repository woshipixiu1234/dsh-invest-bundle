// lib/search.js — 三路降级检索：Tavily → Exa → DuckDuckGo（无 Key 兜底）
import { httpGet, httpPost, resolveSecret, htmlToText, decodeEntities } from './util.js';

const DEFAULTS = { limit: 8, timeoutMs: 20000 };

export async function searchProviderStatus(ctx) {
  const tavily = await resolveSecret(ctx, ['TAVILY_API_KEY']);
  const exa = await resolveSecret(ctx, ['EXA_API_KEY', 'MCPORTER_EXA_API_KEY']);
  return {
    tavily: { available: Boolean(tavily.value), source: tavily.source },
    exa: { available: Boolean(exa.value), source: exa.source },
    duckduckgo: { available: true, source: 'keyless' },
  };
}

async function tavilySearch(ctx, query, limit, opts) {
  const key = (await resolveSecret(ctx, ['TAVILY_API_KEY'])).value;
  if (!key) return { ok: false, reason: 'no TAVILY_API_KEY' };
  const res = await httpPost(
    'https://api.tavily.com/search',
    {
      api_key: key,
      query,
      max_results: limit,
      search_depth: opts.depth || 'basic',
      include_answer: false,
      include_raw_content: false,
      topic: opts.topic || 'general',
    },
    { timeoutMs: opts.timeoutMs },
  );
  if (!res.ok || !res.okStatus) {
    return { ok: false, reason: `tavily http ${res.status || res.error}` };
  }
  try {
    const json = JSON.parse(res.body);
    const results = (json.results || []).map((r) => ({
      title: String(r.title || '').trim(),
      url: String(r.url || ''),
      snippet: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 320),
      score: r.score,
    }));
    return { ok: true, provider: 'tavily', results };
  } catch (err) {
    return { ok: false, reason: `tavily parse: ${err.message}` };
  }
}

async function exaSearch(ctx, query, limit, opts) {
  const key = (await resolveSecret(ctx, ['EXA_API_KEY', 'MCPORTER_EXA_API_KEY'])).value;
  if (!key) return { ok: false, reason: 'no EXA_API_KEY' };
  const res = await httpPost(
    'https://api.exa.ai/search',
    {
      query,
      numResults: limit,
      type: 'auto',
      contents: { text: { maxCharacters: 600 } },
    },
    { headers: { 'x-api-key': key }, timeoutMs: opts.timeoutMs },
  );
  if (!res.ok || !res.okStatus) return { ok: false, reason: `exa http ${res.status || res.error}` };
  try {
    const json = JSON.parse(res.body);
    const results = (json.results || []).map((r) => ({
      title: String(r.title || '').trim(),
      url: String(r.url || ''),
      snippet: String(r.text || r.summary || '').replace(/\s+/g, ' ').trim().slice(0, 320),
      published: r.publishedDate || '',
    }));
    return { ok: true, provider: 'exa', results };
  } catch (err) {
    return { ok: false, reason: `exa parse: ${err.message}` };
  }
}

function absolutize(href, base) {
  let h = decodeEntities(href || '').trim();
  if (!h) return '';
  if (h.startsWith('//')) h = `https:${h}`;
  if (h.startsWith('http')) return h;
  try {
    return new URL(h, base).toString();
  } catch {
    return h;
  }
}

function ddgUnwrap(href) {
  const abs = absolutize(href, 'https://duckduckgo.com');
  try {
    const u = new URL(abs);
    const target = u.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
  } catch {
    /* ignore */
  }
  return abs;
}

async function ddgSearch(query, limit, opts) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`;
  const res = await httpGet(url, { timeoutMs: opts.timeoutMs });
  if (!res.ok || !res.okStatus) return { ok: false, reason: `ddg http ${res.status || res.error}` };
  const html = res.body;
  if (/unusual traffic|检测到异常|robot/i.test(html.slice(0, 3000))) {
    return { ok: false, reason: 'ddg rate-limited' };
  }
  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    const link = ddgUnwrap(m[1]);
    const title = htmlToText(m[2]);
    if (!link || !title) continue;
    results.push({ title, url: link, snippet: '' });
  }
  // 摘要：按顺序贴到结果上（DDG 的 result__snippet 与 result 块同序）
  const snips = [];
  const sre = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let s;
  while ((s = sre.exec(html))) snips.push(htmlToText(s[1]).slice(0, 320));
  results.forEach((r, i) => {
    if (snips[i]) r.snippet = snips[i];
  });
  if (!results.length) return { ok: false, reason: 'ddg parse produced 0 results' };
  return { ok: true, provider: 'duckduckgo', results };
}

async function ddgLiteSearch(query, limit, opts) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await httpGet(url, { timeoutMs: opts.timeoutMs });
  if (!res.ok || !res.okStatus) return { ok: false, reason: `ddg-lite http ${res.status || res.error}` };
  const html = res.body;
  const results = [];
  const re = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    const link = ddgUnwrap(m[1]);
    const title = htmlToText(m[2]);
    if (link && title) results.push({ title, url: link, snippet: '' });
  }
  const snips = [];
  const sre = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  let s;
  while ((s = sre.exec(html))) snips.push(htmlToText(s[1]).slice(0, 320));
  results.forEach((r, i) => {
    if (snips[i]) r.snippet = snips[i];
  });
  if (!results.length) return { ok: false, reason: 'ddg-lite parse produced 0 results' };
  return { ok: true, provider: 'duckduckgo-lite', results };
}

async function bingSearch(query, limit, opts) {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&ensearch=0`;
  const res = await httpGet(url, { timeoutMs: opts.timeoutMs });
  if (!res.ok || !res.okStatus) return { ok: false, reason: `bing http ${res.status || res.error}` };
  const html = res.body;
  const results = [];
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const m = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!m) continue;
    const link = absolutize(m[1], 'https://cn.bing.com');
    const title = htmlToText(m[2]);
    const sn = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = sn ? htmlToText(sn[1]).slice(0, 320) : '';
    if (link && title) results.push({ title, url: link, snippet });
  }
  if (!results.length) return { ok: false, reason: 'bing parse produced 0 results' };
  return { ok: true, provider: 'bing', results };
}

/**
 * 检索。provider=auto 时按 Tavily→Exa→DDG→DDG-Lite→Bing 降级；返回 degraded 标记，绝不假装有结果。
 */
export async function search(ctx, query, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || DEFAULTS.limit, 1), 20);
  const want = String(opts.provider || 'auto').toLowerCase();
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const warnings = [];
  const chain =
    want === 'auto'
      ? ['tavily', 'exa', 'duckduckgo', 'duckduckgo-lite', 'bing']
      : want === 'ddg'
        ? ['duckduckgo', 'duckduckgo-lite']
        : [want];

  for (const provider of chain) {
    let r;
    if (provider === 'tavily') r = await tavilySearch(ctx, query, limit, { timeoutMs, ...opts });
    else if (provider === 'exa') r = await exaSearch(ctx, query, limit, { timeoutMs, ...opts });
    else if (provider === 'duckduckgo') r = await ddgSearch(query, limit, { timeoutMs });
    else if (provider === 'duckduckgo-lite') r = await ddgLiteSearch(query, limit, { timeoutMs });
    else if (provider === 'bing') r = await bingSearch(query, limit, { timeoutMs });
    else {
      warnings.push(`unknown provider: ${provider}`);
      continue;
    }
    if (r.ok && r.results.length) {
      return {
        ok: true,
        query,
        provider: r.provider,
        degraded: r.provider !== 'tavily',
        warnings,
        count: r.results.length,
        results: r.results,
      };
    }
    warnings.push(`${provider}: ${r.reason || 'no results'}`);
  }
  return {
    ok: false,
    query,
    provider: '',
    degraded: true,
    warnings,
    count: 0,
    results: [],
    note: '三路检索全部失败。不要凭记忆编造结果；把 warnings 原样告诉用户。',
  };
}
