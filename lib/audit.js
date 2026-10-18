// lib/audit.js — 读正文的五维来源打分（0-20）。启发式，不是事实核查。
import { daysSince } from './util.js';

const OFFICIAL_HOSTS = [
  'sec.gov', 'hkexnews.hk', 'cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'bse.cn',
  'csrc.gov.cn', 'pbc.gov.cn', 'stats.gov.cn', 'mof.gov.cn', 'ndrc.gov.cn',
  'federalreserve.gov', 'imf.org', 'worldbank.org', 'oecd.org', 'bis.org', 'europa.eu',
];

const WIRE_HOSTS = [
  'reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'barrons.com', 'marketwatch.com',
  'caixin.com', 'yicai.com', 'stcn.com', 'cnstock.com', '21jingji.com', 'eeo.com.cn',
  'nikkei.com', 'scmp.com', 'apnews.com', 'cnbc.com', 'bloomberg.cn', 'cls.cn',
];

const AGG_HOSTS = [
  'eastmoney.com', 'xueqiu.com', '163.com', 'sina.com.cn', 'sohu.com', 'ifeng.com',
  'thepaper.cn', 'jiemian.com', '36kr.com', 'wallstreetcn.com', 'gelonghui.com',
  'medium.com', 'substack.com', 'zhihu.com', 'weibo.com', 'douyin.com', 'bilibili.com',
  'tieba.baidu.com', 'guba.eastmoney.com', 'blog', 'reddit.com', 'twitter.com', 'x.com',
];

const FIRSTHAND_MARKERS = [
  '10-k', '10-q', '20-f', '6-k', '8-k', 'def 14a', '年报', '年度报告', '半年度报告',
  '季度报告', '业绩公告', '公告编号', '招股说明书', '招股书', 'earnings call',
  'transcript', '致股东信', '投资者关系活动记录', 'annual report', 'interim report',
  '电话会纪要', '电话会议', '业绩说明会',
];

const SECONDHAND_MARKERS = [
  '据', '报道', '援引', '转载', '综合', '消息人士', '知情人士', '分析师认为',
  '业内人士', 'according to', 'reported by', 'sources said',
];

const OPINION_MARKERS = [
  '我认为', '笔者', '看好', '建议买', '建议持有', '目标价', '预计将', '有望',
  '值得关注', '强烈推荐', 'bullish', 'bearish', 'catalyst',
];

const HYPE_MARKERS = [
  '必涨', '翻倍', '暴富', '稳赚', '吊打', '神器', '梭哈', '暴涨', '疯抢', '错过就',
  '最后机会', '闭眼买', '一字板', '牛股', '妖股', '财富自由', '躺赚', '绝密', '内幕',
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function anyHost(host, list) {
  return list.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
}

function countMatches(text, markers) {
  const low = String(text || '').toLowerCase();
  let n = 0;
  for (const m of markers) {
    const needle = m.toLowerCase();
    let idx = low.indexOf(needle);
    while (idx !== -1) {
      n += 1;
      idx = low.indexOf(needle, idx + needle.length);
      if (n > 20) break;
    }
  }
  return n;
}

function sentences(text) {
  return String(text || '')
    .split(/(?<=[。！？；!?;])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

function numericRich(text) {
  const m = String(text || '').match(
    /[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|％|亿元|亿|万元|万|千|百万|billion|million|bn|mn|b|m|k|倍|美元|港元|人民币|元)/gi,
  );
  return m ? m.length : 0;
}

const DIMS = ['authority', 'firsthand', 'verifiable', 'freshness', 'bias'];

/**
 * @param {{url:string,title?:string,text?:string,published?:string,type?:string}} src
 */
export function scoreSource(src) {
  const url = String(src.url || '');
  const host = hostOf(url);
  const title = String(src.title || '');
  const body = String(src.text || '');
  const plain = `${title}\n${body}`;
  const dims = {};
  const evidence = [];

  // 1) 权威性 —— 域名层级
  let authority = 1;
  let authorityWhy = '未知来源（默认 1）';
  if (anyHost(host, OFFICIAL_HOSTS) || /\.gov(\.|$)|\.edu(\.|$)|\.int$/.test(host)) {
    authority = 4;
    authorityWhy = '政府/监管/交易所/学术域名';
  } else if (anyHost(host, WIRE_HOSTS)) {
    authority = 3;
    authorityWhy = '主流财经通讯社/财经媒体';
  } else if (/investor|ir\.|\/ir\/|relations/i.test(url) || /投资者关系/.test(plain.slice(0, 400))) {
    authority = 3;
    authorityWhy = '公司投资者关系页面';
  } else if (anyHost(host, AGG_HOSTS)) {
    authority = 2;
    authorityWhy = '聚合站/自媒体/论坛';
  }
  dims.authority = { score: authority, reason: authorityWhy };

  // 2) 一手性 —— 是否原文，而非转述
  const firstCount = countMatches(plain, FIRSTHAND_MARKERS);
  const secondCount = countMatches(plain, SECONDHAND_MARKERS);
  const opinionCount = countMatches(plain, OPINION_MARKERS);
  let firsthand = 2;
  let firsthandWhy = '既无原文标记也无明显转述（默认 2）';
  if (firstCount > 0 && secondCount <= 2) {
    firsthand = 4;
    firsthandWhy = `含原文标记 ${firstCount} 处（10-K/年报/业绩公告等）`;
  } else if (firstCount > 0) {
    firsthand = 3;
    firsthandWhy = `含原文标记 ${firstCount} 处，但夹带转述 ${secondCount} 处`;
  } else if (secondCount >= 3) {
    firsthand = 2;
    firsthandWhy = `转述性表述 ${secondCount} 处，疑似二手编译`;
  } else if (opinionCount >= 2) {
    firsthand = 1;
    firsthandWhy = `观点性表述 ${opinionCount} 处（点评而非披露）`;
  }
  dims.firsthand = { score: firsthand, reason: firsthandWhy };

  // 3) 可验证性 —— 数字与日期密度
  const nums = numericRich(body);
  const hasDate = /20\d{2}\s*[-/年.]\s*\d{1,2}/.test(body);
  let verifiable = 1;
  let verifiableWhy = '几乎无可核对的数字';
  if (nums >= 5) {
    verifiable = 4;
    verifiableWhy = `带单位数字 ${nums} 处`;
  } else if (nums >= 2) {
    verifiable = 3;
    verifiableWhy = `带单位数字 ${nums} 处`;
  } else if (nums === 1) {
    verifiable = 2;
    verifiableWhy = '仅 1 处带单位数字';
  }
  if (hasDate && verifiable < 4) verifiable += 1;
  dims.verifiable = { score: Math.min(verifiable, 4), reason: `${verifiableWhy}${hasDate ? '，含明确日期' : ''}` };

  // 4) 时效性
  const published = String(src.published || '');
  const age = published ? daysSince(published) : null;
  let freshness = 2;
  let freshnessWhy = '未识别发布时间（默认 2）';
  if (age !== null) {
    if (age <= 90) freshness = 4;
    else if (age <= 365) freshness = 3;
    else if (age <= 730) freshness = 2;
    else freshness = 1;
    freshnessWhy = `发布于 ${published}（${age} 天前）`;
  }
  dims.freshness = { score: freshness, reason: freshnessWhy };

  // 5) 偏见/煽动性
  const hype = countMatches(plain, HYPE_MARKERS);
  let bias = 4;
  let biasWhy = '未见明显煽动性用语';
  if (hype > 0) {
    bias = Math.max(1, 4 - Math.min(hype, 3));
    biasWhy = `煽动/夸张用语 ${hype} 处`;
  }
  dims.bias = { score: bias, reason: biasWhy };

  // 证据片段：优先带数字的句子
  const sents = sentences(body);
  const ranked = sents
    .map((s) => ({ s, n: numericRich(s) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((x) => x.s.slice(0, 160));
  evidence.push(...ranked);

  const score = DIMS.reduce((sum, d) => sum + dims[d].score, 0);
  const verdict = score >= 17 ? 'trust' : score >= 11 ? 'caution' : 'discard';
  return {
    url,
    host,
    title,
    score,
    verdict,
    verdictZh: verdict === 'trust' ? '🟢 可信' : verdict === 'caution' ? '🟡 谨慎' : '🔴 弃用',
    dims,
    evidence,
    published,
    caveat:
      '启发式评分：只看域名层级、原文标记、数字密度、发布时效与用语倾向，不判断观点对错，也不能替代对原始报表的核对。',
  };
}

export function auditSources(list) {
  const scored = (list || []).map(scoreSource).sort((a, b) => b.score - a.score);
  const summary = {
    total: scored.length,
    trust: scored.filter((s) => s.verdict === 'trust').length,
    caution: scored.filter((s) => s.verdict === 'caution').length,
    discard: scored.filter((s) => s.verdict === 'discard').length,
  };
  return { sources: scored, summary };
}
