import { runFinanceTool } from '../lib/rigor.js';

const cases = [
  {
    script: 'financial_rigor.py',
    args: ['cross-validate', '--field', 'revenue', '--values', '{"公司财报": 108.3e9, "Yahoo Finance": 107.9e9}', '--unit', 'CNY', '--tolerance', '1.0'],
  },
  {
    script: 'financial_rigor.py',
    args: ['three-scenario', '--price', '500', '--eps', '22.5', '--shares', '91.1', '--growth', '0.12', '0.08', '0.02', '--pe', '22', '18', '12', '--years', '3', '--currency', 'HKD'],
  },
  {
    script: 'financial_rigor.py',
    args: ['benford', '--values', '[1245, 234, 34, 4567, 890, 123, 45, 678, 901, 2345, 345, 456, 567, 6789, 789]'],
  },
  { script: 'report_audit.py', args: ['--help'] },
  { script: 'terminal_value.py', args: ['--help'] },
];

for (const c of cases) {
  const r = await runFinanceTool(c, { toolsDir: '../tools' });
  console.log(`\n=== ${c.script} ${c.args.slice(0, 2).join(' ')} → ok=${r.ok} exit=${r.exitCode}`);
  const out = (r.stdout || r.stderr || '').trim();
  console.log(out.split('\n').slice(0, 18).join('\n'));
}
