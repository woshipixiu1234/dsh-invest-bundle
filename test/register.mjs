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
console.log('\n[PASS] register smoke test');
