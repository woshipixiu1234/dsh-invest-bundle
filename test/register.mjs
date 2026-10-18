// test/register.mjs — 用假 ctx 验证 apply() 的注册路径不会抛错
import { apply, loadSkills } from '../index.js';

const registered = [];
const skills = [];
const logs = [];

const fakeSkillCtx = {
  skills: {
    register(spec) {
      skills.push(spec);
    },
  },
};

const ctx = {
  tools: {
    register(tool) {
      registered.push(tool);
    },
  },
  inject(deps, cb) {
    if (deps.includes('skills')) cb(fakeSkillCtx);
  },
  get() {
    return null;
  },
  logger() {
    return {
      info: (m) => logs.push(`INFO ${m}`),
      warn: (m) => logs.push(`WARN ${m}`),
      error: (m) => logs.push(`ERROR ${m}`),
    };
  },
};

apply(ctx, {});

console.log('tools registered:', registered.length);
for (const t of registered) {
  const required = t.parameters?.required || [];
  console.log(`- ${t.name}: ${t.description.slice(0, 46)}… | required=${JSON.stringify(required)} | hasSchema=${Boolean(t.output?.schema)}`);
}
console.log('skills registered:', skills.length);
for (const s of skills) {
  console.log(`- ${s.name} | whenToUse=${(s.whenToUse || '').slice(0, 40)} | content=${s.content.length}ch`);
}
console.log('logs:', logs);
if (registered.length !== 6) throw new Error(`expected 6 tools, got ${registered.length}`);
if (loadSkills().length !== skills.length) throw new Error('loadSkills 与注册数量不一致');

// DSH 调用 output.render(args, value)：第一参是参数对象，第二参才是执行结果。
// 曾经把 value 当成第一参，导致真实会话里 `output.render failed: Cannot read properties of undefined`。
const fixtures = {
  invest_search: { ok: true, provider: 'bing', degraded: true, count: 0, results: [], warnings: [] },
  invest_fetch: { stats: { ok: 0, attempted: 0, direct: 0, viaJina: 0, failed: 0 }, results: [] },
  invest_audit: { summary: { total: 0, trust: 0, caution: 0, discard: 0 }, sources: [] },
  invest_verify: {
    claim: 'x',
    units: { numbers: [], phrases: [], latin: [] },
    verdict: 'unverified',
    verdictZh: 'x',
    supportingCount: 0,
    analyzedCount: 0,
    details: [],
    method: 'm',
  },
  invest_rigor: { ok: true, stdout: '1', exitCode: 0 },
  invest_channels: {
    summary: { ok: 1, total: 1, harvestOk: 0, harvestTotal: 0, missing: 0, needsKey: 0, needsLogin: 0 },
    rows: [],
    note: 'n',
  },
};

for (const tool of registered) {
  const render = tool.output?.render;
  if (typeof render !== 'function') throw new Error(`${tool.name}: 缺少 output.render`);
  if (render.length < 2) throw new Error(`${tool.name}: render 必须接收 (args, value) 两个参数，当前 arity=${render.length}`);
  const out = render({}, fixtures[tool.name]);
  if (!Array.isArray(out) || typeof out[0]?.text !== 'string') {
    throw new Error(`${tool.name}: render 必须返回 [{type:'text',text}]`);
  }
  console.log(`- render ok: ${tool.name} → ${out[0].text.split('\n')[0].slice(0, 60)}`);
}

console.log('\n[PASS] register smoke test');
