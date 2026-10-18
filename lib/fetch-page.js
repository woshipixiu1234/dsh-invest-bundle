// lib/fetch-page.js — 直抓 → r.jina.ai 升级 → paywall/unreachable 标记
import { httpGet, htmlToText, htmlTitle, looksLikeHtml, extractPublishedDate, resolveSecret, clamp } from './util.js';

const CHALLENGE = [
  'just a moment', 'enable javascript and cookies', 'cf-challenge', 'cf_chl_opt',
  'checking your browser', '验证您是人类', '请开启 javascript', 'access denied',
  'attention required! | cloudflare', 'unusual traffic',
];

const PAYWALL = ['payment required', 'subscribe to continue', '订阅后继续', '付费阅读', 'paywall'];

function looksBlocked(status, body, text) {
  if (status === 402 || status === 451) return true;
  if (status === 403 || status === 429) return true;
  const head = String(body ?? '').slice(0, 4000).toLowerCase();
  if (status === 200 && text.length < 300) return true;
  return CHALLENGE.some((k) => head.includes(k));
}

/**
 * 抓一个 URL 的正文。
 * @returns {Promise<{url:string,ok:boolean,via:string,status:number,title:string,published:string,text:string,
 *   chars:number,truncated:boolean,note:string,error:string}>}
 */
export async function fetchPage(url, opts = {}) {
  const maxChars = opts.maxChars ?? 12000;
  const allowJina = opts.allowJina !== false;
  const out = {
    url, ok: false, via: '', status: 0, title: '', published: '', text: '',
    chars: 0, truncated: false, note: '', error: '',
  };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    out.error = 'invalid-url';
    return out;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    out.error = 'unsupported-protocol';
    return out;
  }

  // 1) 直抓
  const direct = await httpGet(url, { timeoutMs: opts.timeoutMs ?? 25000 });
  let directText = '';
  let blocked = true;
  if (direct.ok) {
    out.status = direct.status;
    if (/pdf/i.test(direct.contentType)) {
      out.note = 'pdf-content-not-parsed';
      blocked = true;
    } else if (looksLikeHtml(direct.body, direct.contentType)) {
      directText = htmlToText(direct.body);
      out.title = htmlTitle(direct.body);
      out.published = extractPublishedDate(direct.body, directText);
      blocked = looksBlocked(direct.status, direct.body, directText);
    } else {
      directText = direct.body.trim();
      blocked = directText.length < 120;
    }
  } else {
    out.error = direct.error || 'network-error';
  }

  if (!blocked && directText) {
    out.ok = true;
    out.via = 'direct';
    out.text = directText;
  } else if (allowJina) {
    // 2) r.jina.ai 升级
    const jinaKey = opts.jinaKey || '';
    const headers = { accept: 'text/plain', 'x-respond-with': 'text' };
    if (jinaKey) headers.authorization = `Bearer ${jinaKey}`;
    const jina = await httpGet(`https://r.jina.ai/${url}`, {
      headers,
      accept: 'text/plain',
      timeoutMs: opts.timeoutMs ?? 40000,
    });
    const body = jina.ok ? jina.body : '';
    const lowered = `${body} ${jina.error || ''}`.toLowerCase();
    if (jina.ok && jina.status === 402) {
      out.status = 402;
      out.error = 'paywall';
      out.note = 'jina reported 402 payment required';
    } else if (jina.ok && body.trim().length > 120) {
      out.ok = true;
      out.via = 'jina';
      out.status = jina.status;
      out.text = body.trim();
      if (!out.title) {
        const firstLine = out.text.split('\n').find((l) => l.trim());
        out.title = (firstLine || '').replace(/^Title:\s*/i, '').slice(0, 160);
      }
      if (!out.published) out.published = extractPublishedDate('', out.text);
      if (PAYWALL.some((k) => lowered.includes(k))) {
        out.note = '可能为付费墙/摘要页，正文不完整';
      }
    } else if (PAYWALL.some((k) => lowered.includes(k))) {
      out.error = 'paywall';
    } else {
      out.error = out.error || 'blocked-or-unreachable';
      out.note = `direct=${direct.ok ? direct.status : direct.error}; jina=${jina.ok ? jina.status : jina.error}`;
    }
  }

  if (out.ok) {
    out.text = clamp(out.text, maxChars);
    out.chars = out.text.length;
    out.truncated = out.text.includes('（已截断');
  }
  return out;
}

export async function jinaKeyFor(ctx) {
  const s = await resolveSecret(ctx, ['JINA_API_KEY', 'JINA_KEY', 'R_JINA_API_KEY']);
  return s.value;
}

/** 多 URL 串行抓取（限流友好），返回结果数组与统计 */
export async function fetchMany(ctx, urls, opts = {}) {
  const max = opts.max ?? 6;
  const maxChars = opts.maxChars ?? 12000;
  const jinaKey = await jinaKeyFor(ctx);
  const results = [];
  const list = (urls || []).map((u) => String(u).trim()).filter(Boolean).slice(0, max);
  for (const url of list) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await fetchPage(url, { maxChars, jinaKey }));
  }
  return {
    results,
    stats: {
      requested: (urls || []).length,
      attempted: list.length,
      ok: results.filter((r) => r.ok).length,
      direct: results.filter((r) => r.via === 'direct').length,
      viaJina: results.filter((r) => r.via === 'jina').length,
      failed: results.filter((r) => !r.ok).length,
    },
  };
}
