// lib/report.js — 报告交付链工具：图表渲染、Markdown→PDF、PDF 质检、四大师 workflow 装载
// 依赖 tools/report/*.py（纯 python-docx + 标准库 + matplotlib），不改动上游 tools/*.py。
import fs from 'node:fs';
import path from 'node:path';
import { run, pythonBin } from './rigor.js';

export const REPORT_SCRIPTS = {
  chart: 'make_charts.py',
  pdf: 'build_report_pdf.py',
  check: 'check_pdf.py',
};

/** 相对路径按调用方 cwd 解析（缺省 process.cwd()），绝对路径原样返回 */
export function resolvePath(p, cwd) {
  const s = String(p ?? '').trim();
  if (!s) return '';
  if (path.isAbsolute(s)) return path.normalize(s);
  return path.resolve(cwd || process.cwd(), s);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

/** 从 stdout 里挖出最后一个 JSON 对象（脚本可能夹带日志行） */
export function extractJson(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function reportToolsDir(cfg) {
  return cfg.reportToolsDir || path.join(cfg.root || process.cwd(), 'tools', 'report');
}

function scriptPath(cfg, key) {
  return path.join(reportToolsDir(cfg), REPORT_SCRIPTS[key]);
}

function missingScript(script, cfg) {
  return {
    ok: false,
    error: `报告工具缺失：${script}`,
    hint: `检查插件 tools/report/ 是否完整（${reportToolsDir(cfg)}），或重装 dsh-invest-bundle`,
  };
}

async function runPy(cfg, script, args, opts = {}) {
  const python = pythonBin(cfg);
  if (!fs.existsSync(script)) return { missing: true, script, python, args };
  const res = await run(python, [script, ...args], {
    cwd: opts.cwd || cfg.cwd || process.cwd(),
    timeoutMs: opts.timeoutMs ?? 180000,
  });
  return { missing: false, script, python, args, ...res };
}

function shape(res, scriptName) {
  const parsed = extractJson(res.stdout);
  const out = {
    ok: Boolean(res.ok) && (!parsed || parsed.ok !== false),
    tool: scriptName,
    python: res.python,
    script: res.script,
    args: res.args,
    exitCode: res.exitCode,
    result: parsed,
    stdout: String(res.stdout || '').trim().slice(0, 8000),
    stderr: String(res.stderr || '').trim().slice(0, 4000),
  };
  if (!res.ok) {
    const err = `${res.stderr}\n${res.error || ''}`;
    if (/No module named|ModuleNotFoundError/i.test(err)) {
      out.hint = '缺 Python 依赖：pip install python-docx matplotlib（或按报错里的模块名安装）';
    } else if (/not recognized|ENOENT|找不到/i.test(err)) {
      out.hint = `找不到解释器 ${res.python}：用 config.python 或环境变量 DSH_PYTHON 指定 python.exe 绝对路径`;
    } else if (/LibreOffice|soffice|engine/i.test(err)) {
      out.hint = 'PDF 引擎不可用：优先安装 DSH 的 LibreOffice Kit 或 LibreOffice；Chrome/Word 只作兜底';
    }
  }
  return out;
}

/**
 * 生成图表：spec 可内联（写到 <reportDir>/charts/spec.json）或给 specPath。
 * @param {{spec?:object,specPath?:string,outDir:string,dpi?:number,widthIn?:number,cwd?:string}} input
 */
export async function runChartTool(input, cfg) {
  const base = input.cwd ? resolvePath(input.cwd) : cfg.cwd;
  const reportDir = resolvePath(input.outDir, base);
  if (!reportDir) return { ok: false, error: 'outDir 必填（报告目录）' };
  const chartDir = path.join(reportDir, 'charts');
  let specPath = resolvePath(input.specPath, base);
  if (!specPath) {
    if (!input.spec || typeof input.spec !== 'object') {
      return { ok: false, error: '需要 spec（对象）或 specPath（文件路径）' };
    }
    specPath = writeJson(path.join(chartDir, 'spec.json'), input.spec);
  }
  if (!fs.existsSync(specPath)) return { ok: false, error: `spec 不存在：${specPath}` };
  const args = ['--spec', specPath, '--out-dir', chartDir, '--json'];
  if (input.dpi) args.push('--dpi', String(input.dpi));
  if (input.widthIn) args.push('--width-in', String(input.widthIn));
  const res = await runPy(cfg, scriptPath(cfg, 'chart'), args, { cwd: reportDir, timeoutMs: 180000 });
  if (res.missing) return missingScript(res.script, cfg);
  return shape(res, REPORT_SCRIPTS.chart);
}

/**
 * Markdown → docx → PDF。
 * @param {{md:string,outDir?:string,meta?:object,metaPath?:string,engine?:string,noDocx?:boolean,cwd?:string}} input
 */
export async function runPdfTool(input, cfg) {
  const base = input.cwd ? resolvePath(input.cwd) : cfg.cwd;
  const mdPath = resolvePath(input.md, base);
  if (!mdPath) return { ok: false, error: 'md 必填（report.md 路径）' };
  if (!fs.existsSync(mdPath)) return { ok: false, error: `md 不存在：${mdPath}` };
  const reportDir = resolvePath(input.outDir, base) || path.dirname(mdPath);
  ensureDir(reportDir);
  let metaPath = resolvePath(input.metaPath, base);
  if (!metaPath) {
    if (!input.meta || typeof input.meta !== 'object') {
      return { ok: false, error: '需要 meta（对象）或 metaPath（文件路径）' };
    }
    metaPath = writeJson(path.join(reportDir, 'report-meta.json'), input.meta);
  }
  if (!fs.existsSync(metaPath)) return { ok: false, error: `meta 不存在：${metaPath}` };
  const args = ['--md', mdPath, '--out-dir', reportDir, '--meta', metaPath, '--json'];
  if (input.engine) args.push('--engine', String(input.engine));
  if (input.noDocx) args.push('--no-docx');
  const res = await runPy(cfg, scriptPath(cfg, 'pdf'), args, { cwd: reportDir, timeoutMs: 300000 });
  if (res.missing) return missingScript(res.script, cfg);
  const out = shape(res, REPORT_SCRIPTS.pdf);
  if (out.ok && out.result) {
    out.pdf = out.result.pdf || '';
    out.pages = out.result.pages || 0;
    out.images = out.result.images || 0;
    out.docx = out.result.docx || '';
  }
  return out;
}

/**
 * PDF 质检（页数/插图/文本量，可选渲染页面）。
 * @param {{pdf:string,renderPages?:number,renderDir?:string,cwd?:string}} input
 */
export async function runPdfCheckTool(input, cfg) {
  const base = input.cwd ? resolvePath(input.cwd) : cfg.cwd;
  const pdfPath = resolvePath(input.pdf, base);
  if (!pdfPath) return { ok: false, error: 'pdf 必填（report.pdf 路径）' };
  if (!fs.existsSync(pdfPath)) return { ok: false, error: `pdf 不存在：${pdfPath}` };
  const args = ['--pdf', pdfPath, '--json'];
  if (input.renderPages) {
    args.push('--render-pages', String(input.renderPages));
    if (input.renderDir) args.push('--render-dir', resolvePath(input.renderDir, base));
  }
  const res = await runPy(cfg, scriptPath(cfg, 'check'), args, { cwd: path.dirname(pdfPath), timeoutMs: 180000 });
  if (res.missing) return missingScript(res.script, cfg);
  const out = shape(res, REPORT_SCRIPTS.check);
  if (out.result) {
    out.pages = out.result.pages || 0;
    out.images = out.result.images || 0;
  }
  return out;
}

/** 读四大师 workflow 脚本 + meta + 预填 args，避免模型手抄路径 */
export function workflowBundle(input = {}, cfg = {}) {
  const root = cfg.root || process.cwd();
  const scriptFile = path.join(root, 'workflows', 'four-masters.js');
  const metaFile = path.join(root, 'workflows', 'four-masters.meta.json');
  const contractFile = path.join(root, 'docs', 'report-pipeline.md');
  if (!fs.existsSync(scriptFile)) return { ok: false, error: `workflow 脚本缺失：${scriptFile}`, hint: '重装插件或检查 workflows/ 是否随包发布' };
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch (err) {
    return { ok: false, error: `workflow meta 解析失败：${err.message}` };
  }
  const script = fs.readFileSync(scriptFile, 'utf8');
  const company = String(input.company || '').trim();
  if (!company) return { ok: false, error: 'company 必填（公司简称，如「贵州茅台」）' };
  const asOf = String(input.asOf || '').trim() || new Date().toISOString().slice(0, 10);
  const base = input.cwd ? resolvePath(input.cwd, cfg.cwd) : cfg.cwd || process.cwd();
  const outDir =
    resolvePath(input.outDir, base) || path.join(base, 'reports', `${company}-深度研究-${asOf}`);
  const reportsTools = reportToolsDir(cfg);
  const workflowArgs = {
    company,
    ticker: String(input.ticker || '').trim(),
    market: String(input.market || 'A股').trim(),
    asOf,
    outDir,
    python: pythonBin(cfg),
    chartScript: path.join(reportsTools, REPORT_SCRIPTS.chart),
    pdfScript: path.join(reportsTools, REPORT_SCRIPTS.pdf),
    checkScript: path.join(reportsTools, REPORT_SCRIPTS.check),
    contractPath: contractFile,
    coverPath: resolvePath(input.coverPath, base),
    peers: String(input.peers || '').trim(),
    wordTarget: String(input.wordTarget || '8000-10000').trim(),
  };
  maintainDir(outDir);
  return {
    ok: true,
    meta,
    script,
    scriptPath: scriptFile,
    metaPath: metaFile,
    args: workflowArgs,
    paths: {
      workflowScript: scriptFile,
      workflowMeta: metaFile,
      contract: contractFile,
      chartScript: workflowArgs.chartScript,
      pdfScript: workflowArgs.pdfScript,
      checkScript: workflowArgs.checkScript,
      reportDir: outDir,
    },
    note: '把 script 原样传给 workflow 工具（不要改写缩进/模板字符串），meta 与 args 同传；运行结束只在 pdf.pages>=8 且 images>=4 时向用户报告完成。',
  };
}

function maintainDir(dir) {
  try {
    fs.mkdirSync(path.join(dir, 'charts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  } catch {
    /* 目录不可写时由后续工具报错 */
  }
}
