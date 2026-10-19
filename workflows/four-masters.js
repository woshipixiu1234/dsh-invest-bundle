// 四大师投研 workflow —— 四个真实并行的 Agent，产出图文并茂的 PDF。
// 由 dsh-tool-workflow 顶层调用才会在会话里生成「运行/阶段/成员」进度节点。
// 契约：docs/report-pipeline.md。脚本内不得使用 Node API（fs/net/timer 均不可用）。

const A = args || {};
const company = A.company || '目标公司';
const ticker = A.ticker || '';
const market = A.market || 'A股';
const asOf = A.asOf || '';
const outDir = A.outDir || '';
const py = A.python || 'python';
const chartScript = A.chartScript || '';
const pdfScript = A.pdfScript || '';
const checkScript = A.checkScript || '';
const contractPath = A.contractPath || '';
const coverPath = A.coverPath || '';
const peersHint = A.peers || '';
const wordTarget = A.wordTarget || '8000-10000';

if (!outDir || !chartScript || !pdfScript) {
  throw new Error('args 缺少 outDir / chartScript / pdfScript：由调用方传入绝对路径');
}

const TOOLS = '本插件工具 invest_search / invest_fetch / invest_rigor；若 invest_search 返回无关结果或 provider 显示降级通道（bing/duckduckgo），立即改用 web_search 找入口，再用 invest_fetch 或 web_fetch 读正文。禁止用训练记忆冒充本轮检索。';
const RULES = [
  '每个关键数字必须给出来源（URL 或「公告名 + 日期」），并标注 as_of；',
  '关键数字尽量两源交叉，误差 >1% 要标记；',
  'PE/市值/股息率等计算必须调用 invest_rigor（financial_rigor.py），禁止心算；',
  '不得编造数据；查不到就写「未获取」，并降低 confidence；',
  '结论必须明确，不要两面话；允许多空分歧。',
].join('\n- ');

const S = {
  brief: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      ticker: { type: 'string' },
      market: { type: 'string' },
      info_grade: { type: 'string', enum: ['A', 'B', 'C'] },
      one_liner: { type: 'string' },
      key_questions: { type: 'array', items: { type: 'string' } },
      peers: { type: 'array', items: { type: 'string' } },
      snapshot: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            source: { type: 'string' },
            asof: { type: 'string' },
          },
          required: ['label', 'value', 'source'],
          additionalProperties: false,
        },
      },
      data_confidence: { type: 'string' },
    },
    required: ['name', 'ticker', 'market', 'info_grade', 'one_liner', 'key_questions', 'snapshot'],
    additionalProperties: false,
  },
  master: {
    type: 'object',
    properties: {
      dimension: { type: 'string' },
      verdict: { type: 'string' },
      score: { type: 'number' },
      confidence: { type: 'string', enum: ['A', 'B', 'C'] },
      thesis: { type: 'string' },
      key_findings: { type: 'array', items: { type: 'string' } },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            value: { type: 'string' },
            source: { type: 'string' },
            asof: { type: 'string' },
          },
          required: ['claim', 'value', 'source'],
          additionalProperties: false,
        },
      },
      risks: { type: 'array', items: { type: 'string' } },
      dissent: { type: 'string' },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['dimension', 'verdict', 'score', 'confidence', 'thesis', 'key_findings', 'evidence', 'risks', 'dissent'],
    additionalProperties: false,
  },
  cross: {
    type: 'object',
    properties: {
      agreements: { type: 'array', items: { type: 'string' } },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            positions: { type: 'array', items: { type: 'string' } },
            importance: { type: 'string', enum: ['high', 'medium', 'low'] },
            resolution: { type: 'string' },
          },
          required: ['topic', 'positions', 'importance', 'resolution'],
          additionalProperties: false,
        },
      },
      score_table: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            master: { type: 'string' },
            dimension: { type: 'string' },
            score: { type: 'number' },
            one_line: { type: 'string' },
          },
          required: ['master', 'dimension', 'score', 'one_line'],
          additionalProperties: false,
        },
      },
      consensus: { type: 'string' },
      blind_spots: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string' },
    },
    required: ['agreements', 'conflicts', 'score_table', 'consensus', 'blind_spots', 'verdict'],
    additionalProperties: false,
  },
  writer: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      mdPath: { type: 'string' },
      metaPath: { type: 'string' },
      evidencePath: { type: 'string' },
      sections: { type: 'array', items: { type: 'string' } },
      figures: { type: 'array', items: { type: 'string' } },
      wordCount: { type: 'number' },
      keyNumbers: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, value: { type: 'string' }, source: { type: 'string' } },
          required: ['label', 'value', 'source'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'subtitle', 'mdPath', 'metaPath', 'sections', 'figures', 'wordCount'],
    additionalProperties: false,
  },
  layout: {
    type: 'object',
    properties: {
      pdfPath: { type: 'string' },
      docxPath: { type: 'string' },
      pages: { type: 'number' },
      images: { type: 'number' },
      charts: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      attempts: { type: 'number' },
    },
    required: ['pdfPath', 'pages', 'images', 'charts'],
    additionalProperties: false,
  },
  audit: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      pdfPath: { type: 'string' },
      pages: { type: 'number' },
      images: { type: 'number' },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
          required: ['name', 'pass', 'detail'],
          additionalProperties: false,
        },
      },
      issues: { type: 'array', items: { type: 'string' } },
      sampledNumbers: { type: 'array', items: { type: 'string' } },
    },
    required: ['pass', 'pages', 'images', 'checks', 'issues'],
    additionalProperties: false,
  },
};

const briefPrompt = [
  `你是投研团队 Team Lead，标的：${company}（${ticker || '代码待确认'}，${market}），报告日 ${asOf}。`,
  '先做一次轻量摸底，为后续四位大师提供共用简报（不做完整研究，控制在 6 次检索/抓取以内）：',
  '1) 确认公司全称、代码、上市地、最新财报期（附公告链接）；',
  '2) 抓 3-6 个最关键的事实：最新收盘价/总市值/PE(TTM)/股息率/最近一期营收与净利，每个都要 source + asof；',
  '3) 判断信息丰富度 A（覆盖充分）/ B（一般）/ C（稀缺），并说明对研究策略的影响；',
  '4) 列出 4-6 个这场研究必须回答的核心问题；',
  '5) 列 3-5 个最相关的同业或对照公司。',
  '',
  `工具：${TOOLS}`,
  '研究纪律：\n- ' + RULES,
  '',
  '严格按 schema 返回 JSON，snapshot 每项 {label,value,source,asof}；没有把握的数字写「未获取」，不要编。',
].join('\n');

phase('① 研究简报 · 摸底与定题');
log(`标的 ${company}（${ticker || '?'}），报告日 ${asOf}`);
let brief = await agent(briefPrompt, { label: '研究简报', schema: S.brief });
if (!brief) {
  log('研究简报 agent 失败，使用最小简报继续（后续质量可能下降）');
  brief = {
    name: company,
    ticker,
    market,
    info_grade: 'B',
    one_liner: '简报缺失：需从四位大师分析中补齐事实基础',
    key_questions: ['这门生意的本质是什么', '当前估值是否提供安全边际', '竞争格局是否在恶化', '十年后的确定性有多高'],
    peers: peersHint ? String(peersHint).split(/[,，、]/).map((x) => x.trim()).filter(Boolean) : [],
    snapshot: [],
  };
}
const briefJson = JSON.stringify(brief, null, 2);
log(`简报完成：${brief.name} · 信息等级 ${brief.info_grade} · 事实 ${brief.snapshot.length} 条`);

const masters = [
  {
    label: '段永平 · 商业模式',
    key: 'duan',
    dim: '商业模式',
    question: '这是不是一门好生意？',
    focus: [
      '生意本质：公司到底靠什么赚钱？把收入拆成「量 × 价 × 结构」，指出真正的利润来源；',
      '用户/客户价值：为消费者、渠道、股东分别创造了什么不可替代的价值；',
      '护城河逐项验证：品牌溢价、转换成本、网络效应、规模效应、成本优势、牌照/产地壁垒——哪些是真的、哪些只是叙事；',
      '定价权：过去 5 年提价能力与终端价差，提价会不会伤量；',
      '段永平标准：差异化、本分、长期主义、看得懂的生意、不为清单（不懂不碰）；',
      '给出这门生意 10 年后是否还存在的判断，以及「本分」层面的隐忧。',
    ],
  },
  {
    label: '巴菲特 · 财务估值',
    key: 'buffett',
    dim: '财务估值',
    question: '价格是否明显低于价值？',
    focus: [
      '近 5-10 年营收、归母净利、经营现金流、自由现金流的趋势与质量（利润是否变成现金）；',
      '盈利能力：毛利率、净利率、ROE（杜邦拆解）、ROIC；与同业和自身历史对比；',
      '资产负债表：货币资金、有息负债、存货/合同负债、应收、资本开支；',
      '股东回报：分红率、股息率、回购，分红是否可持续；',
      '估值：PE/PB/EV-EBITDA/自由现金流收益率，历史分位与同业对比；三情景（乐观/中性/悲观）目标价；',
      '安全边际：内在价值区间 vs 现价，明确「贵/合理/便宜」，并说明用什么价格买入才划算；',
      '所有计算必须调用 invest_rigor 验证（市值验算、估值验算、三情景），把工具输出写进 evidence。',
    ],
  },
  {
    label: '芒格 · 行业竞争',
    key: 'munger',
    dim: '行业竞争',
    question: '反过来想：它会怎么死？',
    focus: [
      '行业规模、增速、渗透率与所处周期；需求端是不是在结构性走弱（人口、消费习惯、政策）；',
      '竞争格局：主要对手份额、价格带、渠道结构；对手的进攻点在哪里；',
      '逆向思考：列出 5 种「这家公司会死/会大幅衰退」的具体情景，并给概率与领先指标；',
      '产业链议价：上游成本、下游渠道库存与批价；渠道利差是否在恶化；',
      '替代品与新技术/新品类冲击；',
      '反共识检查：聪明人为什么在做空/看空？市场共识里最脆弱的一环是什么；',
      '给出「竞争格局是在变好还是变坏」的明确判断。',
    ],
  },
  {
    label: '李录 · 风险与管理层',
    key: 'li',
    dim: '风险与管理层',
    question: '十年后的确定性有多高？',
    focus: [
      '管理层：能力圈、诚信记录、战略眼光、资本配置（分红/回购/并购/多元化）历史成绩单；',
      '治理结构：股权结构、关联交易、大股东行为、激励机制、国企/民企体制约束；',
      '监管与政策风险：税收、价格管制、反腐、行业规范，哪些会直接打在利润上；',
      '长期确定性：10 年后公司的收入与利润靠什么支撑？什么会颠覆它？',
      '红线清单：8 条一票否决项逐条过（管理层诚信、财务造假、不可逆的政策风险等）；',
      '李录框架：文明级趋势、知识的诚实、安全边际之外的风险；',
      '给出「十年确定性」评分与最需要持续跟踪的 3 个指标。',
    ],
  },
];

phase('② 四大师并行研判');
log('四位大师开始并行研究（各自独立取数、独立判断）');

const masterResults = await parallel(
  masters.map((m) => async () => {
    const prompt = [
      `你是「${m.label}」，四大师投研团队中独立负责「${m.dim}」维度的分析师。你不与其他大师商量，独立取数、独立判断；结论允许和其他大师冲突，冲突本身是信息。`,
      '',
      `【标的】${company}（${ticker || '代码待确认'}，${market}），报告日 ${asOf}。`,
      `【你的核心问题】${m.question}`,
      '',
      '【Team Lead 的研究简报】',
      briefJson,
      '',
      '【你的分析清单】',
      m.focus.map((x, i) => `${i + 1}. ${x}`).join('\n'),
      '',
      `【取数与纪律】工具：${TOOLS}`,
      '- ' + RULES,
      '- 至少读 5 个来源；优先一手（年报/季报/公告/交易所），其次高质量媒体；',
      '- 时间盒：12 次工具调用以内，目标 8 分钟内完成；',
      '',
      '【输出】严格按 schema 返回 JSON，字段含义：',
      '- dimension：固定为「' + m.dim + '」；verdict：一句话结论（不超过 60 字，必须明确）；',
      '- score：1-5 分（5=极好），confidence：A/B/C；thesis：120-200 字的核心论证；',
      '- key_findings：3-6 条，每条 30-80 字，带关键数字；',
      '- evidence：4-8 条 {claim,value,source,asof}，source 写 URL 或公告名+日期；',
      '- risks：2-5 条；dissent：你与其他大师最可能冲突的一点（一句话）；open_questions：1-3 条。',
    ].join('\n');
    return agent(prompt, { label: m.label, schema: S.master });
  }),
);

const okMasters = masterResults.filter(Boolean);
log(`四大师完成 ${okMasters.length}/4：${okMasters.map((x) => `${x.dimension} ${x.score}`).join(' · ')}`);
if (!okMasters.length) throw new Error('四个大师 agent 全部失败：检查模型与联网通道后重跑');

phase('③ 交叉质证 · 结论允许冲突');
const crossPrompt = [
  '你是四大师投研团队的质证主持人（Team Lead）。下面是四位分析师独立完成的结论。你的任务不是折中，而是把「真实分歧」找出来并向证据对齐。',
  '',
  `【标的】${company}（${ticker || '代码待确认'}，${market}），报告日 ${asOf}。`,
  '【四份分析】',
  JSON.stringify(okMasters, null, 2),
  '',
  '【你要做】',
  '1) 提炼 3-5 条共识（必须带数字）；',
  '2) 列出 2-4 个实质冲突：谁和谁、分歧点、为什么重要、用哪个数据/事实可以裁决、裁决结论或「暂无法裁决」；不要为了和谐抹平冲突；',
  '3) 识别 2-4 个「四位都忽视的盲点」（例如只看利润不看现金流、只看国内不看出海）；',
  '4) 汇总四维评分表（沿用各大师 score，不许篡改；如认为评分与证据不符，在 resolution/共识里说明）；',
  '5) 给出一句话总判断与前置条件。',
  '',
  '严格按 schema 返回 JSON；conflicts.positions 用「大师名：立场」的字符串数组。',
].join('\n');
const cross = await agent(crossPrompt, { label: '交叉质证', schema: S.cross });
if (!cross) log('交叉质证失败：汇总稿将只依赖四位大师原始结论');
log(cross ? `质证完成：共识 ${cross.agreements.length} · 冲突 ${cross.conflicts.length} · 盲点 ${cross.blind_spots.length}` : '质证缺失');

phase('④ 汇总成稿 · 结构化长文');
const dataDir = outDir + '/data';
const writerPrompt = [
  '你是四大师投研团队的主笔。把四位大师的独立分析 + 交叉质证，写成一份可直接发布的深度研究报告（Markdown），并写封面元数据。',
  '',
  `【标的】${company}（${ticker || '代码待确认'}，${market}），报告日 ${asOf}。`,
  `【输出目录】${outDir}（正文写到 report.md，封面元数据写到 report-meta.json）。`,
  `【必读】${contractPath} 的 §4 Markdown 语法与 §5 meta 字段；正文必须严格使用该子集，否则 PDF 渲染会丢内容。`,
  '',
  '【结构与要求】正文 9 章，目标 ' + wordTarget + ' 字，禁止空话：',
  '一、一句话结论与投资评级（结论前置，给出买入/持有/回避与价格区间）',
  '二、生意本质：段永平视角',
  '三、财务质量与估值：巴菲特视角（关键数字必须来自 evidence；计算用 invest_rigor 复核）',
  '四、竞争格局与逆向思考：芒格视角（含「它会怎么死」的情景表）',
  '五、风险、管理层与十年确定性：李录视角（含红线清单）',
  '六、四维评分与关键分歧（把交叉质证里的冲突如实写进去，不要抹平）',
  '七、核心数据速览（2-3 张对比表）',
  '八、分层操作建议与催化剂（激进/稳健/保守三档 + 加仓/减仓信号）',
  '九、数据来源与抓取时间（表格：数据点/来源/时间；抓不到的写「未获取」）',
  '',
  '【图表占位符】在正文合适位置单独一行写：<!-- figure: f1 | 图表主题 | 这张图要说明什么 -->，共 5-7 个（f1-f7）。每个 `##` 章节至少一个图表或表格。不要自己写图片路径。',
  '【meta】report-meta.json 必填：title/ticker/kicker/subtitle/as_of/metrics(2-4 个，{label,value})/core({title,paragraphs,verdict})/sources_asof/disclaimer/footer。指标优先用简报和 evidence 里已核实的数字；未核实就不放。',

  `【数据留档】把简报 + 四份分析 + 交叉质证的原始 JSON 写到 ${dataDir}/evidence.json（合法 JSON、不要代码围栏），这是溯源链的硬要求。`,  '【纪律】不得引入四位大师 evidence 之外的新数字；引用要保留 source；结论要明确；冲突要保留。',
  '',
  '【四份分析】',
  JSON.stringify(okMasters, null, 2),
  '',
  '【交叉质证】',
  JSON.stringify(cross || { note: '质证缺失' }, null, 2),
  '',
  '完成后返回 JSON：title/subtitle/mdPath/metaPath/evidencePath/sections（章标题数组）/figures（占位符主题数组）/wordCount/keyNumbers（5-8 个核心数字）。',
].join('\n');
const draft = await agent(writerPrompt, { label: '主笔 · 汇总成稿', schema: S.writer });
if (!draft) {
  return { ok: false, error: '汇总成稿失败：主笔 agent 未返回结果', brief, masters: okMasters, cross };
}
log(`成稿完成：${draft.wordCount} 字 · ${draft.sections.length} 章 · ${draft.figures.length} 个图表位`);

phase('⑤ 图表与排版 · 图文并茂 PDF');
const layoutPrompt = [
  '你是排版与可视化工程师。任务：把 report.md 变成一份图文并茂的 A4 PDF（这是本次任务的最终交付物）。',
  '',
  `【目录】${outDir}`,
  `【必读】${contractPath}（§1 视觉规范、§3 图表 spec、§4 Markdown 子集、§5 meta、§6 build_report_pdf.py）`,
  `【正文】${draft.mdPath}`,
  `【封面元数据】${draft.metaPath}`,
  `【Python】${py}`,
  `【图表工具】${chartScript}`,
  `【PDF 工具】${pdfScript}`,
  '',
  '【步骤】',
  '1) 读 report.md 与 report-meta.json，理解全文；',
  '2) 按正文里的 <!-- figure: f1 | 主题 | 说明 --> 占位符设计 5-7 张图：写 ' + outDir + '/charts/spec.json（契约 §3），只用正文/数据里出现过的数字，不准新造数据；图表类型按信息选择（趋势 line、结构 barh/donut、对比 grouped_bar、敏感性 heatmap、拆解 waterfall、估值 combo）；',
  `3) 运行：${py} "${chartScript}" --spec "${outDir}/charts/spec.json" --out-dir "${outDir}/charts" --json；失败就改 spec 重跑（最多 3 轮）；`,
  '4) 用生成的 PNG 替换占位符：把 <!-- figure: fN | 主题 | 说明 --> 改为 ![图 N：一句人话结论](charts/<文件名>.png)（路径相对 report.md），保留图表顺序；',
  '5) 运行：' + py + ' "' + pdfScript + '" --md "' + draft.mdPath + '" --out-dir "' + outDir + '" --meta "' + draft.metaPath + '" --json' + (coverPath ? '（meta.cover.path 若为空，写入 "' + coverPath + '"）' : ''),
  '6) 校验产物：pages >= 8、images >= 4、%PDF- 签名；不达标回步骤 2 补图或修排版，最多 3 轮；',
  '7) 用 read 工具读取 PDF 工具返回的 JSON，确认最终 pdf 路径。',
  '',
  '【风格】克制的卖方深度报告：不要花哨颜色、不要 emoji、不要 3D；图注写结论而不写「如图所示」；每张图都要有来源脚注。',
  '',
  '返回 JSON：pdfPath/docxPath/pages/images/charts（图 id 与标题数组）/warnings/attempts。',
].join('\n');
const layout = await agent(layoutPrompt, { label: '排版 · 图表与 PDF', schema: S.layout });
if (!layout) {
  return { ok: false, error: '排版失败：未生成 PDF', brief, masters: okMasters, cross, draft };
}
log(`PDF 生成：${layout.pages} 页 · ${layout.images} 张图 · ${layout.pdfPath}`);

phase('⑥ 准出审计 · 数字抽检与终检');
const auditPrompt = [
  '你是准出审核员。目标不是挑刺，而是确认这份 PDF 可以交付。',
  '',
  `【目录】${outDir}`,
  `【正文】${draft.mdPath}`,
  `【PDF】${layout.pdfPath}`,
  `【契约】${contractPath} §8 质量门槛`,
  `【Python】${py}`,
  '',
  '【检查项】',
  '1) 页面与插图：运行 ' + py + ' "' + checkScript + '" --pdf "' + layout.pdfPath + '" --json，确认 pages>=8、images>=4；',
  '2) 图片引用：report.md 里每个 ![..](path) 对应文件必须存在（相对 report.md 解析）；',
  '3) 占位符：正文不得残留 TODO/待补/XXX/未替换的 {{ 或 <!-- figure；',
  '4) 数字抽检：从正文抽 6 个关键数字（营收、净利、毛利率、PE、市值、股息率等），逐个回 excel / data JSON / 大师 evidence 找依据，记录「数字 → 依据 → 通过/存疑」；',
  '5) 数据留档：data/evidence.json 必须存在且是合法 JSON；缺失写进 issues（不算致命，但要在 detail 里标出）；',
  '6) 一致性：正文结论与交叉质证冲突是否保留了分歧（不许把冲突写成一致）；',
  '7) 封面与页脚：pdfinfo 页数 + 目录结构；封面有公司名与报告日；',
  '8) 运行 invest_rigor 的 report_audit.py extract --report "' + draft.mdPath + '"（能跑就跑，失败不阻塞，但要记录）。',
  '',
  '只做检查与记录，不要改写正文/PDF。若发现致命问题（PDF 缺页、图片全丢、关键数字自相矛盾），在 issues 里写清并 pass=false。',
  '返回 JSON：pass/pages/images/checks（{name,pass,detail}）/issues/sampledNumbers。',
].join('\n');
const audit = await agent(auditPrompt, { label: '准出审计', schema: S.audit });

const pages = (audit && audit.pages) || layout.pages || 0;
const images = (audit && audit.images) || layout.images || 0;
const pdfPath = (audit && audit.pdfPath) || layout.pdfPath;
const pass = !!(pdfPath && pages >= 8 && images >= 4 && (!audit || audit.pass !== false));

log(pass ? `准出通过：${pdfPath}（${pages} 页 / ${images} 张图）` : `准出未通过：pages=${pages} images=${images}`);

return {
  ok: pass,
  company: brief.name || company,
  ticker: brief.ticker || ticker,
  asOf,
  pdf: { path: pdfPath, pages, images, bytes: layout.bytes || 0 },
  docx: layout.docxPath || '',
  charts: layout.charts || [],
  masters: okMasters.map((m) => ({ dimension: m.dimension, score: m.score, confidence: m.confidence, verdict: m.verdict })),
  conflicts: cross ? cross.conflicts : [],
  audit: audit ? { pass: audit.pass, checks: audit.checks, issues: audit.issues } : null,
  reportDir: outDir,
  warnings: (layout.warnings || []).concat(audit && audit.issues ? audit.issues : []),
};
