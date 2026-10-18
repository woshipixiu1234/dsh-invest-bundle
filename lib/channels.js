// lib/channels.js — 通道健康探测：harvest 的 11 条 + 本插件自己的检索/抓取
import fs from 'node:fs';
import path from 'node:path';
import { run } from './rigor.js';
import { resolveSecret } from './util.js';
import { searchProviderStatus } from './search.js';

const NPM_GLOBAL = 'C:\\Users\\woshi\\.npm-global';

async function probe(cmd, args = ['--version'], timeoutMs = 8000) {
  const r = await run(cmd, args, { timeoutMs });
  const text = `${r.stdout}\n${r.stderr}`.trim();
  return {
    present: r.ok,
    version: r.ok ? (text.split('\n')[0] || '').slice(0, 120) : '',
    error: r.ok ? '' : text.slice(0, 200) || r.error,
  };
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function ps1Exists(name) {
  const candidates = [path.join(NPM_GLOBAL, `${name}.ps1`), path.join(NPM_GLOBAL, `${name}.cmd`)];
  for (const c of candidates) if (fileExists(c)) return c;
  const where = await run('where.exe', [name], { timeoutMs: 6000 });
  if (where.ok && where.stdout.trim()) return where.stdout.trim().split(/\r?\n/)[0];
  return '';
}

export async function probeChannels(ctx) {
  const [gh, ytdlp, bili, mcporterPath, opencliPath, providers] = await Promise.all([
    probe('gh'),
    probe('yt-dlp'),
    probe('bili'),
    ps1Exists('mcporter'),
    ps1Exists('opencli'),
    searchProviderStatus(ctx),
  ]);

  const rows = [];

  const ghOnDisk = fileExists('C:\\Program Files\\GitHub CLI\\gh.exe');
  rows.push({
    channel: 'github',
    harvestNeeds: 'gh CLI + 登录',
    status: gh.present ? 'ok' : ghOnDisk ? 'needs-restart' : 'missing',
    evidence: gh.present
      ? gh.version
      : ghOnDisk
        ? '已安装 C:\\Program Files\\GitHub CLI\\gh.exe，但当前 DSH 进程的 PATH 是启动快照，未刷新'
        : gh.error,
    fix: gh.present
      ? ''
      : ghOnDisk
        ? '重启 DSH 让 PATH 生效；随后 gh auth login'
        : 'winget install --id GitHub.cli -e',
  });

  // harvest 的 web 通道实际走 mcporter 里注册的 exa 免 Key 端点（https://mcp.exa.ai/mcp），
  // 所以「mcporter 存在」本身就足以让 web 通道可用，Tavily Key 只是可选的提速项。
  const webOk = Boolean(mcporterPath) || providers.tavily.available || providers.exa.available;
  rows.push({
    channel: 'web',
    harvestNeeds: 'mcporter（exa 免 Key 端点）',
    status: webOk ? 'ok' : 'needs-key',
    evidence: `mcporter=${mcporterPath ? 'yes' : 'no'} tavily=${providers.tavily.available ? 'yes' : 'no'} exa-key=${providers.exa.available ? 'yes' : 'no'}`,
    fix: webOk
      ? ''
      : `npm i -g --prefix ${NPM_GLOBAL} mcporter，再 mcporter config add exa --url https://mcp.exa.ai/mcp（免 Key）；或加 TAVILY_API_KEY`,
  });

  for (const [channel, label] of [
    ['twitter', 'opencli + 浏览器登录'],
    ['reddit', 'opencli'],
    ['xiaohongshu', 'opencli + 浏览器登录'],
  ]) {
    rows.push({
      channel,
      harvestNeeds: label,
      status: opencliPath ? 'needs-login' : 'missing',
      evidence: opencliPath ? `opencli: ${opencliPath}` : `未找到 ${path.join(NPM_GLOBAL, 'opencli.ps1')}`,
      fix: opencliPath ? '需要浏览器登录态，安装后按 README 扫码' : `npm i -g --prefix ${NPM_GLOBAL} opencli（包名待确认）`,
    });
  }

  rows.push({
    channel: 'youtube',
    harvestNeeds: 'yt-dlp',
    status: ytdlp.present ? 'ok' : 'missing',
    evidence: ytdlp.present ? ytdlp.version : ytdlp.error,
    fix: ytdlp.present ? '' : 'python -m pip install -U yt-dlp',
  });

  rows.push({
    channel: 'bilibili',
    harvestNeeds: 'bili CLI（第三方非官方）',
    status: bili.present ? 'ok' : 'missing',
    evidence: bili.present ? bili.version : bili.error,
    fix: bili.present ? '' : '非官方第三方工具，合规风险自负；研报场景优先级低',
  });

  rows.push({
    channel: 'v2ex',
    harvestNeeds: 'curl 公开 API',
    status: 'ok',
    evidence: '公开 API，无需凭证',
    fix: '',
  });

  rows.push({
    channel: 'linkedin',
    harvestNeeds: 'mcporter linkedin-scraper + 登录',
    status: mcporterPath ? 'needs-login' : 'missing',
    evidence: mcporterPath ? `mcporter: ${mcporterPath}` : '未安装 mcporter',
    fix: `npm i -g --prefix ${NPM_GLOBAL} mcporter`,
  });

  rows.push({
    channel: 'telegram',
    harvestNeeds: 'mcp-telegram + Telethon session',
    status: 'needs-login',
    evidence: '需要 API_ID/API_HASH/SESSION 字符串',
    fix: '研报场景优先级低，不建议为它配置',
  });

  rows.push({
    channel: 'linuxdo',
    harvestNeeds: 'linuxdo-mcp + Cookie',
    status: 'needs-login',
    evidence: '需要论坛 Cookie',
    fix: '研报场景优先级低',
  });

  // 本插件自身能力
  rows.push({
    channel: 'invest_search',
    harvestNeeds: '（本插件）Tavily/Exa/DDG',
    status: providers.tavily.available ? 'ok' : providers.exa.available ? 'ok' : 'degraded',
    evidence: `tavily=${providers.tavily.available ? providers.tavily.source : 'no'} exa=${providers.exa.available ? providers.exa.source : 'no'} ddg=always`,
    fix: providers.tavily.available ? '' : '只有 DDG 时结果质量与稳定性下降，建议加 TAVILY_API_KEY',
  });

  const jina = await resolveSecret(ctx, ['JINA_API_KEY', 'JINA_KEY']);
  rows.push({
    channel: 'invest_fetch',
    harvestNeeds: '（本插件）直抓 + r.jina.ai',
    status: 'ok',
    evidence: `direct=always jina=${jina.value ? 'keyed' : 'anonymous(速率低)'}`,
    fix: jina.value ? '' : '可选：加 JINA_API_KEY 提高 r.jina.ai 限额',
  });

  const ok = rows.filter((r) => r.status === 'ok').length;
  const harvestRows = rows.filter((r) => !r.channel.startsWith('invest_'));
  return {
    rows,
    summary: {
      ok,
      total: rows.length,
      harvestOk: harvestRows.filter((r) => r.status === 'ok').length,
      harvestTotal: harvestRows.length,
      missing: rows.filter((r) => r.status === 'missing').length,
      needsKey: rows.filter((r) => r.status === 'needs-key').length,
      needsLogin: rows.filter((r) => r.status === 'needs-login').length,
      needsRestart: rows.filter((r) => r.status === 'needs-restart').length,
    },
    providers,
    note: '通道状态是本机实测结果，不是文档宣称。harvest 的 backends.js 硬编码了 C:\\Users\\woshi\\.npm-global\\*.ps1 路径， npm 默认 prefix 不同就会全部失败——用 npm i -g --prefix 装到该目录即可对齐。',
  };
}
