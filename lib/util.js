// lib/util.js — 零依赖基础件：文本块、HTTP、HTML→文本、凭证、日期
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** execute 返回值 → DSH 内容块 */
export const text = (t) => [{ type: 'text', text: String(t ?? '') }];

export const clamp = (s, n) => {
  const str = String(s ?? '');
  if (str.length <= n) return str;
  return `${str.slice(0, n)}\n……（已截断 ${str.length - n} 字符）`;
};

/** 与 @stifer/dsh-harvest 相同的工具定义形态，但不依赖任何外部包 */
export function defineTool(spec) {
  const tool = {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters || { type: 'object', properties: {} },
    output: {
      schema: spec.schema || { type: 'object', additionalProperties: true },
      ...(spec.render ? { render: spec.render } : {}),
    },
    execute: spec.execute,
  };
  return tool;
}

async function request(url, init = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    const buf = await res.arrayBuffer();
    const body = Buffer.from(buf).toString('utf8');
    return {
      ok: true,
      status: res.status,
      okStatus: res.ok,
      contentType: res.headers.get('content-type') || '',
      url: res.url || url,
      body,
    };
  } catch (err) {
    return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
  } finally {
    clearTimeout(timer);
  }
}

export function httpGet(url, opts = {}) {
  const headers = {
    'user-agent': UA,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    accept: opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(opts.headers || {}),
  };
  return request(url, { method: 'GET', headers }, opts.timeoutMs);
}

export function httpPost(url, body, opts = {}) {
  const headers = {
    'user-agent': UA,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(opts.headers || {}),
  };
  return request(
    url,
    { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) },
    opts.timeoutMs,
  );
}

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·',
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => (ENTITIES[m.toLowerCase()] !== undefined ? ENTITIES[m.toLowerCase()] : m));
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** HTML → 纯文本（保留段落边界，去掉导航噪音后由调用方截断） */
export function htmlToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|canvas|template|iframe)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table)>/gi, '\n');
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, '\t');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

export function htmlTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

export function looksLikeHtml(body, contentType = '') {
  if (/html/i.test(contentType)) return true;
  const head = String(body ?? '').slice(0, 800).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html');
}

/** 发布时间粗提取：meta 标签优先，其次正文前 3000 字符里的 2024-01-31 / 2024年1月31日 */
export function extractPublishedDate(html, plainText = '') {
  const raw = String(html ?? '');
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:pubdate|publishdate|publish-date|date|dc.date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of metaPatterns) {
    const m = re.exec(raw);
    if (m) {
      const d = parseDateLoose(m[1]);
      if (d) return d;
    }
  }
  const zone = String(plainText || htmlToText(raw)).slice(0, 3000);
  const m = /(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(zone);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return '';
}

export function parseDateLoose(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 1990) {
    return direct.toISOString().slice(0, 10);
  }
  const m = /(20\d{2})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}

export function daysSince(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/** 去掉 YAML frontmatter，返回 { meta, body } —— 只支持单层 key: value */
export function stripFrontmatter(raw) {
  const src = String(raw ?? '').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^"(.*)"$/.test(v)) v = v.slice(1, -1);
    else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1);
    meta[kv[1]] = v;
  }
  return { meta, body: src.slice(m[0].length).trim() };
}

/** 从 env → DSH credentials → .credentials.yaml 三级解析密钥 */
export async function resolveSecret(ctx, names = []) {
  for (const n of names) {
    if (process.env[n]) return { value: process.env[n], source: `env:${n}` };
  }
  const creds = typeof ctx?.get === 'function' ? ctx.get('credentials') : null;
  if (creds) {
    for (const n of names) {
      for (const fn of ['resolve', 'get']) {
        if (typeof creds[fn] !== 'function') continue;
        try {
          const raw = await creds[fn](n);
          const v = typeof raw === 'string' ? raw : raw?.value ?? raw?.secret ?? raw?.token;
          if (v && String(v).trim()) return { value: String(v).trim(), source: `credentials.${fn}:${n}` };
        } catch {
          /* try next */
        }
      }
    }
  }
  const file = credentialsFile();
  if (file && fs.existsSync(file)) {
    const yaml = fs.readFileSync(file, 'utf8');
    for (const n of names) {
      const re = new RegExp(`(?:^|\\n)\\s*${n}\\s*:\\s*\\n?\\s*(?:value|secret|token)?\\s*:?\\s*["']?([^"'\\n\\r]+)["']?`, 'i');
      const m = re.exec(yaml);
      if (m && m[1] && m[1].trim() && !/^[a-z-]+$/i.test(m[1].trim())) {
        return { value: m[1].trim(), source: `file:${path.basename(file)}` };
      }
      const inline = new RegExp(`(?:^|\\n)\\s*${n}\\s*:\\s*["']?([^"'\\n\\r#]+)["']?`, 'i').exec(yaml);
      if (inline && inline[1] && inline[1].trim()) {
        return { value: inline[1].trim(), source: `file:${path.basename(file)}` };
      }
    }
  }
  return { value: '', source: '' };
}

export function credentialsFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const p = path.join(home, '.credentials.yaml');
  return fs.existsSync(p) ? p : null;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
