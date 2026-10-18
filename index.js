// index.js — dsh-invest-bundle：把 berkshire 方法论 + 可用的检索/取数/校验通道注册成 DSH 原生工具与技能
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool, text, clamp, stripFrontmatter } from './lib/util.js';
import { search, searchProviderStatus } from './lib/search.js';
import { fetchMany, fetchPage } from './lib/fetch-page.js';
import { auditSources } from './lib/audit.js';
import { verifyClaim } from './lib/verify.js';
import { runFinanceTool, checkPython, ALLOWED_SCRIPTS } from './lib/rigor.js';
import { probeChannels } from './lib/channels.js';

export const name = 'dsh-invest-bundle';
export const inject = ['tools'];

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const TOOLS_DIR = path.join(ROOT, 'tools');

const fmtSearch = (r) => {
  if (!r.ok) {
    return [
      `检索失败（provider=${r.provider || 'none'}）`,
      ...r.warnings.map((w) => `- ${w}`),
      '',
      '⚠️ 不要凭记忆补写结果。把失败原因原样告诉用户，或让用户配置 TAVILY_API_KEY。',
    ].join('\n');
  }
  const lines = [
    `provider: ${r.provider}${r.degraded ? '（降级通道，结果质量与稳定性较低）' : ''}`,
    `命中: ${r.count}`,
  ];
  if (r.warnings.length) lines.push(`降级过程: ${r.warnings.join(' | ')}`);
  lines.push('');
  r.results.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.title || '(no title)'}`);
    lines.push(`   ${x.url}`);
    if (x.snippet) lines.push(`   ${x.snippet}`);
  });
  return lines.join('\n');
};

const fmtFetch = (r) => {
  const lines = [
    `抓取统计: 成功 ${r.stats.ok}/${r.stats.attempted}（直抓 ${r.stats.direct} / jina 升级 ${r.stats.viaJina} / 失败 ${r.stats.failed}）`,
    '',
  ];
  r.results.forEach((x) => {
    lines.push(`### ${x.url}`);
    lines.push(
      `状态: ${x.ok ? `✅ ${x.via}` : `❌ ${x.error || 'failed'}`}${x.note ? `（${x.note}）` : ''} · HTTP ${x.status || '-'} · ${x.chars} 字符`,
    );
    if (x.title) lines.push(`标题: ${x.title}`);
    if (x.published) lines.push(`发布: ${x.published}`);
    lines.push('');
    lines.push(x.ok ? clamp(x.text, 6000) : '（无正文）');
    lines.push('');
  });
  if (r.stats.ok === 0) {
    lines.push('⚠️ 全部抓取失败：不允许用记忆里的内容代替正文，也不允许编造引用。');
  }
  return lines.join('\n');
};

export function apply(ctx, config = {}) {
  const log = typeof ctx.logger === 'function' ? ctx.logger('invest-bundle') : console;
  const settings = {
    python: config?.python || process.env.DSH_PYTHON || '',
    toolsDir: TOOLS_DIR,
  };

  ctx.tools.register(
    defineTool({
      name: 'invest_search',
      description:
        '联网检索（三路降级：Tavily → Exa → DuckDuckGo 无 Key 兜底）。用于找财报原文、公告、新闻、行业数据、电话会纪要的一手入口。返回真实可抓取的 URL 列表，并明确标记 degraded。检索失败时绝不返回虚假结果——这时必须告诉用户而不是凭记忆作答。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索式。中文英文都可以；找一手资料时可加 site: 限定（如 site:cninfo.com.cn）' },
          limit: { type: 'number', description: '返回条数，默认 8，最大 20' },
          provider: {
            type: 'string',
            enum: ['auto', 'tavily', 'exa', 'duckduckgo', 'bing'],
            description: '默认 auto（自动降级）。只在需要排除某个通道时显式指定。',
          },
        },
        required: ['query'],
      },
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          provider: { type: 'string' },
          degraded: { type: 'boolean' },
          count: { type: 'number' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, url: { type: 'string' }, snippet: { type: 'string' } },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => text(fmtSearch(value)),
      execute: async (args) => {
        const r = await search(ctx, String(args?.query || '').trim(), {
          limit: args?.limit,
          provider: args?.provider,
        });
        return r;
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'invest_fetch',
      description:
        '抓取网页正文（直抓 → Cloudflare/JS 页自动升级 r.jina.ai → 标记 paywall/unreachable）。单次最多 6 个 URL。用于把 invest_search 找到的入口变成可引用的正文；抓取失败的 URL 会明确标失败原因，不允许用记忆内容冒充。',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'URL 列表，最多 6 条' },
          maxChars: { type: 'number', description: '单页正文上限，默认 12000 字符' },
          allowJina: { type: 'boolean', description: '直抓被拦时是否升级 r.jina.ai，默认 true' },
        },
        required: ['urls'],
      },
      schema: {
        type: 'object',
        properties: {
          stats: { type: 'object' },
          results: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, value) => text(fmtFetch(value)),
      execute: async (args) => {
        const urls = Array.isArray(args?.urls) ? args.urls : [];
        return fetchMany(ctx, urls, { max: 6, maxChars: args?.maxChars });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'invest_audit',
      description:
        '来源可信度审计（读正文的五维打分 0-20：权威性/一手性/可验证性/时效性/偏见），阈值 ≥17 可信、≥11 谨慎、否则弃用。与 harvest_audit 的区别：harvest 只看 URL 猜，本工具读正文里的原文标记、数字密度、发布时间与煽动用语。结果自带 caveat，是启发式而非事实核查。',
      parameters: {
        type: 'object',
        properties: {
          sources: {
            type: 'array',
            description: '直接给内容：每项 {url, title?, text?, published?}。与 urls 二选一。',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                text: { type: 'string' },
                published: { type: 'string' },
              },
            },
          },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: '只给 URL 时自动抓正文再打分（最多 4 条）',
          },
        },
      },
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'object' },
          sources: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, r) => {
        if (!r || !r.summary) return text('审计没有返回结果');
        const lines = [
          `审计 ${r.summary.total} 条：🟢 ${r.summary.trust} / 🟡 ${r.summary.caution} / 🔴 ${r.summary.discard}`,
          '',
        ];
        r.sources.forEach((s) => {
          lines.push(`${s.verdictZh} ${s.score}/20 — ${s.title || s.host || s.url}`);
          lines.push(`  ${s.url}`);
          for (const [k, v] of Object.entries(s.dims)) lines.push(`  · ${k}: ${v.score}/4 — ${v.reason}`);
          if (s.evidence.length) lines.push(`  证据: ${s.evidence[0]}`);
          lines.push('');
        });
        lines.push(`⚠️ ${r.sources[0]?.caveat || ''}`);
        return text(lines.join('\n'));
      },
      execute: async (args) => {
        const sources = Array.isArray(args?.sources) ? [...args.sources] : [];
        if (Array.isArray(args?.urls) && args.urls.length) {
          const fetched = await fetchMany(ctx, args.urls, { max: 4, maxChars: 8000 });
          for (const f of fetched.results) {
            if (f.ok) sources.push({ url: f.url, title: f.title, text: f.text, published: f.published });
            else sources.push({ url: f.url, title: '', text: '', published: '', unreachable: true });
          }
        }
        const result = auditSources(sources);
        return result;
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'invest_verify',
      description:
        '交叉验证一条断言：按「数字覆盖率×0.7 + 短语覆盖率×0.3」计算每个来源的支持度（≥0.6 且数字覆盖≥50% 才算支持），并检测同一单位下数值偏差>5% 的冲突。替代 harvest_verify 的「任一关键词命中即算支持」。仍需人复核，是启发式不是事实核查。',
      parameters: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: '待验证的断言，例如「腾讯 2025 年营收约 7000 亿元」' },
          sources: {
            type: 'array',
            description: '已有正文：每项 {url, title?, text}',
            items: {
              type: 'object',
              properties: { url: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
            },
          },
          urls: { type: 'array', items: { type: 'string' }, description: '只给 URL 时自动抓正文（最多 5 条）' },
        },
        required: ['claim'],
      },
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string' },
          supportingCount: { type: 'number' },
          details: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args, r) => {
        if (!r || !r.units) return text('验证没有返回结果');
        const lines = [
          `断言: ${r.claim}`,
          `判定: ${r.verdictZh}`,
          `支持来源: ${r.supportingCount}/${r.analyzedCount}`,
          `拆解: 数字 ${r.units.numbers.join(' / ') || '无'}；短语 ${r.units.phrases.slice(0, 8).join(' / ') || '无'}`,
          '',
        ];
        r.details.forEach((d, i) => {
          lines.push(`${i + 1}. ${d.title || d.url || '(内联正文)'} — combined ${d.combined}（数字 ${d.numericCoverage} / 短语 ${d.phraseCoverage}）${d.support ? ' ✅支持' : ''}${d.conflictCount ? ` ❌冲突 ${d.conflictCount}` : ''}`);
          if (d.excerpt) lines.push(`   ${d.excerpt}`);
          d.conflicts.slice(0, 2).forEach((c) => lines.push(`   ⚠️ 冲突: 断言 ${c.claim} vs 来源 ${c.found} — ${c.sentence}`));
          lines.push('');
        });
        lines.push(r.method);
        return text(lines.join('\n'));
      },
      execute: async (args) => {
        const claim = String(args?.claim || '').trim();
        const sources = Array.isArray(args?.sources) ? [...args.sources] : [];
        if (Array.isArray(args?.urls) && args.urls.length) {
          const fetched = await fetchMany(ctx, args.urls, { max: 5, maxChars: 12000 });
          for (const f of fetched.results) {
            if (f.ok) sources.push({ url: f.url, title: f.title, text: f.text });
          }
        }
        return verifyClaim(claim, sources);
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'invest_rigor',
      description:
        '执行随包附带的 Python 投研工具（白名单）：financial_rigor.py（市值/估值验算、两源交叉验证、Benford 造假检测、三情景）、terminal_value.py、report_audit.py（报告准出审核）、reports_index.py、stock_screener.py、ashare_data.py、twstock_data.py、xueqiu_scraper.py、morningstar_fair_value.py。凡是研报里的计算，必须用本工具验算，禁止心算。',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', enum: ALLOWED_SCRIPTS, description: '脚本文件名' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '参数数组，逐项传入（不经过 shell）。例如 ["verify-market-cap","--price","510","--shares","9.11e9","--reported","4.65e12","--currency","HKD"]',
          },
          cwd: { type: 'string', description: '工作目录（报告落盘时用），默认当前工作区' },
        },
        required: ['script'],
      },
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
        },
      },
      render: (_args, r) => {
        if (!r) return text('工具没有返回结果');
        if (!r.ok) {
          return text([`❌ ${r.script || 'tool'} 执行失败（exit ${r.exitCode ?? '?'}）`, r.stderr || r.error || '', r.hint || ''].filter(Boolean).join('\n'));
        }
        return text(r.stdout || '(无输出)');
      },
      execute: async (args) => runFinanceTool(args, settings),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'invest_channels',
      description:
        '探测本机投研通道健康度：harvest 的 11 条通道（gh/yt-dlp/mcporter/opencli/bili/v2ex/telegram/linuxdo…）+ 本插件自己的检索/抓取通道，逐条给实测状态与修复命令，并列出还缺哪些 Key/登录。开工前先跑一次，避免拿不可用的通道假装查到东西。',
      parameters: { type: 'object', properties: {} },
      schema: {
        type: 'object',
        properties: { summary: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } } },
      },
      render: (_args, r) => {
        if (!r || !r.summary) return text('通道探测没有返回结果');
        const lines = [
          `通道健康度：可用 ${r.summary.ok}/${r.summary.total}；harvest ${r.summary.harvestOk}/${r.summary.harvestTotal}；缺命令 ${r.summary.missing}；缺 Key ${r.summary.needsKey}；需登录 ${r.summary.needsLogin}`,
          '',
        ];
        r.rows.forEach((row) => {
          const icon = row.status === 'ok' ? '✅' : row.status === 'degraded' ? '🟡' : row.status === 'needs-key' ? '🔑' : row.status === 'needs-login' ? '🔓' : '❌';
          lines.push(`${icon} ${row.channel} (${row.status}) — 需要: ${row.harvestNeeds}`);
          if (row.evidence) lines.push(`   ${row.evidence}`);
          if (row.fix) lines.push(`   修: ${row.fix}`);
        });
        lines.push('', r.note);
        return text(lines.join('\n'));
      },
      execute: async () => probeChannels(ctx),
    }),
  );

  registerSkills(ctx, log);
  log.info?.(`dsh-invest-bundle ready · tools=6 · skills=${countSkills()}`);
}

function countSkills() {
  try {
    return fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md'))).length;
  } catch {
    return 0;
  }
}

function loadSkills() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = stripFrontmatter(raw);
    if (!body) continue;
    out.push({
      name: meta.name || entry.name,
      description: meta.description || '',
      whenToUse: meta.whenToUse || meta['when-to-use'] || '',
      content: body,
      dir: entry.name,
    });
  }
  return out;
}

function registerSkills(ctx, log) {
  const skills = loadSkills();
  if (!skills.length) {
    log.warn?.('dsh-invest-bundle: skills/ 目录下没有找到 SKILL.md，技能未注册（若刚跑完适配脚本请检查路径）');
    return;
  }
  if (typeof ctx.inject !== 'function') {
    log.warn?.('dsh-invest-bundle: 当前 ctx 不支持 inject，技能未注册');
    return;
  }
  ctx.inject(['skills'], (skillCtx) => {
    for (const s of skills) {
      try {
        skillCtx.skills.register({
          name: s.name,
          description: s.description || `${s.name}（ai-berkshire 方法论）`,
          whenToUse: s.whenToUse || s.description,
          source: 'runtime',
          content: s.content,
          invocation: { modelInvocable: true, userInvocable: true },
        });
      } catch (err) {
        log.warn?.(`技能注册失败 ${s.name}: ${err && err.message ? err.message : err}`);
      }
    }
    log.info?.(`dsh-invest-bundle: 已注册 ${skills.length} 个投研技能`);
  });
}

// 便于测试：导出内部函数
export { loadSkills, fmtSearch, fmtFetch };
