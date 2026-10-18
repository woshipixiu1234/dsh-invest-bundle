// lib/rigor.js — 白名单 Python 工具执行器（execFile，无 shell，参数数组直传）
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_SCRIPTS = [
  'financial_rigor.py',
  'terminal_value.py',
  'report_audit.py',
  'reports_index.py',
  'stock_screener.py',
  'ashare_data.py',
  'twstock_data.py',
  'xueqiu_scraper.py',
  'morningstar_fair_value.py',
];

export function pythonBin(config = {}) {
  if (config.python) return config.python;
  if (process.env.DSH_PYTHON) return process.env.DSH_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export function run(file, args, opts = {}) {
  const timeout = opts.timeoutMs ?? 90000;
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd || process.cwd(),
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
      (err, stdout, stderr) => {
        const exitCode = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
        resolve({
          ok: !err,
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : '',
        });
      },
    );
  });
}

export async function checkPython(config = {}) {
  const bin = pythonBin(config);
  const r = await run(bin, ['--version'], { timeoutMs: 15000 });
  return {
    bin,
    ok: r.ok,
    version: (r.stdout || r.stderr || '').trim(),
    error: r.ok ? '' : r.error || r.stderr.trim(),
  };
}

/**
 * 执行白名单脚本。
 * @param {{script:string,args?:string[],cwd?:string,timeoutMs?:number}} input
 * @param {{toolsDir:string,python?:string}} cfg
 */
export async function runFinanceTool(input, cfg) {
  const script = String(input.script || '').trim();
  if (!script) return { ok: false, error: 'script is required' };
  const base = path.basename(script);
  if (!ALLOWED_SCRIPTS.includes(base)) {
    return {
      ok: false,
      error: `script not allowed: ${base}`,
      allowed: ALLOWED_SCRIPTS,
    };
  }
  const scriptPath = path.join(cfg.toolsDir, base);
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      error: `script file missing: ${scriptPath}`,
      hint: '插件 tools/ 目录未包含该脚本，先让 berkshire 适配任务把 tools/*.py 复制进来。',
    };
  }
  const args = (input.args || []).map((a) => String(a));
  for (const a of args) {
    if (a.length > 4000) return { ok: false, error: 'argument too long' };
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(a)) return { ok: false, error: 'control characters in argument' };
  }
  const cwd = input.cwd && fs.existsSync(input.cwd) ? input.cwd : process.cwd();
  const bin = pythonBin(cfg);
  const res = await run(bin, [scriptPath, ...args], { cwd, timeoutMs: input.timeoutMs });
  const out = {
    ok: res.ok,
    script: base,
    args,
    cwd,
    python: bin,
    exitCode: res.exitCode,
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim(),
  };
  if (!res.ok) {
    const err = `${res.stderr}\n${res.error}`;
    if (/No module named/i.test(err)) out.hint = '缺 Python 依赖：按报错里的模块名 pip install。financial_rigor.py 只用标准库，不应出现该错误。';
    else if (/not recognized|ENOENT|找不到/i.test(err)) out.hint = `找不到解释器 ${bin}：用 config.python 或环境变量 DSH_PYTHON 指定 python.exe 绝对路径。`;
    else if (/unrecognized arguments|invalid choice/i.test(err)) out.hint = '参数不被该子命令接受：先不带参数跑一次看 usage。';
  }
  return out;
}
