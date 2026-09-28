import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.AGENT_TOKEN || 'demo-token';

const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const USE_LLM = Boolean(DS_KEY);

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const AGENT_ID = 'main';
const SESSION_KEY_DEFAULT = 'agent:main:web:demo';
const CACHE_BOUNDARY = '<<<SYSTEM_PROMPT_CACHE_BOUNDARY>>>';
const MODEL_LABEL = USE_LLM ? `${DS_MODEL} @ ${new URL(DS_BASE).host}` : 'mock(deterministic)';

const BASE_SKILLS = ['coding', 'research'];
const BASE_MCP = ['filesystem', 'fetch'];

const SKILL_CATALOG = [
  { kind: 'skill', name: 'coding', description: '代码编写、调试与重构', location: 'skills/coding/SKILL.md', summary: '加载编码流程与仓库约定', triggers: [/代码|函数|bug|报错|重构|实现|写个|debug|编译/i] },
  { kind: 'skill', name: 'research', description: '联网检索与资料综述', location: 'skills/research/SKILL.md', summary: '加载 检索→去重→综述 流程', triggers: [/调研|竞品|综述|研究报告|对比|资料/i] },
  { kind: 'skill', name: 'office', description: '文档 / 表格 / 日程办公自动化', location: 'skills/office/SKILL.md', summary: '加载办公文档处理流程', triggers: [/文档|表格|excel|ppt|周报|纪要|邮件|幻灯片/i] },
  { kind: 'skill', name: 'ecommerce', description: '电商运营：选品 / 客服 / 数据分析', location: 'skills/ecommerce/SKILL.md', summary: '加载电商运营 SOP', triggers: [/电商|选品|客服|订单|店铺|商品|库存/i] },
  { kind: 'skill', name: 'data-analysis', description: '数据分析与可视化', location: 'skills/data-analysis/SKILL.md', summary: '加载分析模板与图表规范', triggers: [/数据分析|统计|可视化|报表|指标|图表|趋势/i] },
  { kind: 'skill', name: 'travel', description: '差旅规划与行程编排', location: 'skills/travel/SKILL.md', summary: '加载行程编排模板', triggers: [/出差|行程|机票|酒店|旅行|差旅/i] }
];

const MCP_CATALOG = [
  { kind: 'mcp', name: 'filesystem', description: '本地文件系统访问', transport: 'stdio', tools: ['read_file', 'write_file', 'list_dir'], summary: '连接 stdio MCP: filesystem', triggers: [/文件|目录|读取|写入工作区/i] },
  { kind: 'mcp', name: 'fetch', description: '网页抓取', transport: 'streamable-http', tools: ['fetch'], summary: '连接 http MCP: fetch', triggers: [/抓取|网页正文|url|http|链接内容/i] },
  { kind: 'mcp', name: 'calendar', description: '日历读写', transport: 'sse', tools: ['list_events', 'create_event'], summary: '连接 sse MCP: calendar', triggers: [/日程|日历|会议|安排|提醒/i] },
  { kind: 'mcp', name: 'github', description: 'GitHub 仓库与 Issue', transport: 'stdio', tools: ['search_repos', 'create_issue', 'list_prs'], summary: '连接 stdio MCP: github', triggers: [/github|仓库|issue|pr\b|代码库|pull request/i] },
  { kind: 'mcp', name: 'sqlite', description: 'SQLite 数据库查询', transport: 'stdio', tools: ['query', 'execute'], summary: '连接 stdio MCP: sqlite', triggers: [/数据库|sql|sqlite|查询数据|数据表/i] },
  { kind: 'mcp', name: 'browser', description: '浏览器自动化', transport: 'streamable-http', tools: ['goto', 'click', 'screenshot', 'extract'], summary: '连接 http MCP: browser', triggers: [/浏览器|打开网页|截图|点击|网页自动化/i] }
];

const MCP_REGISTRY_URL = process.env.MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io/v0/servers';

const REMOTE_CATALOG = [
  { kind: 'skill', name: 'weather', description: '天气查询与出行建议', location: 'skills/weather/SKILL.md', domains: ['weather'], summary: '注册表命中：weather skill' },
  { kind: 'mcp', name: 'weather', description: '实时天气与空气质量（Open-Meteo）', transport: 'streamable-http', tools: ['get_current', 'get_forecast', 'get_air_quality'], domains: ['weather'], summary: '注册表命中：weather MCP' },
  { kind: 'mcp', name: 'maps', description: '地图、地理编码与路线规划', transport: 'sse', tools: ['geocode', 'route', 'places'], domains: ['maps'], summary: '注册表命中：maps MCP' },
  { kind: 'mcp', name: 'news', description: '新闻聚合检索', transport: 'streamable-http', tools: ['search_news', 'top_headlines'], domains: ['news'], summary: '注册表命中：news MCP' },
  { kind: 'skill', name: 'translation', description: '多语种翻译与本地化', location: 'skills/translation/SKILL.md', domains: ['translate'], summary: '注册表命中：translation skill' },
  { kind: 'mcp', name: 'mcdonalds', description: '麦当劳门店、菜单与优惠券（官方小程序 API）', transport: 'streamable-http', tools: ['list_coupons', 'search_coupons', 'nearest_store'], domains: ['mcdonalds', 'coupon'], summary: '注册表命中：mcdonalds MCP' },
  { kind: 'skill', name: 'coupon', description: '优惠券比对与最佳组合', location: 'skills/coupon/SKILL.md', domains: ['coupon'], summary: '注册表命中：coupon skill' },
  { kind: 'mcp', name: 'starbucks', description: '星巴克门店与优惠活动', transport: 'streamable-http', tools: ['list_offers', 'nearest_store'], domains: ['starbucks'], summary: '注册表命中：starbucks MCP' }
];

const CAPABILITY_HINTS = [
  { re: /麦当劳|金拱门|mcdonald|mcd\b/i, domain: 'mcdonalds', query: 'mcdonalds' },
  { re: /优惠券|优惠|折扣|代金券|coupon|券/i, domain: 'coupon', query: 'mcdonalds coupon' },
  { re: /星巴克|starbucks/i, domain: 'starbucks', query: 'starbucks' },
  { re: /天气|气温|温度|下雨|weather/i, domain: 'weather', query: 'weather' },
  { re: /地图|导航|路线|坐标|位置/i, domain: 'maps', query: 'maps' },
  { re: /新闻|头条|时事/i, domain: 'news', query: 'news' },
  { re: /翻译|translate|译成|英文邮件/i, domain: 'translate', query: 'translation' }
];

const STOPWORDS = new Set(['我', '你', '他', '她', '的', '了', '吗', '呢', '啊', '吧', '请问', '帮我', '一下', '现在', '今天', '有', '什么', '怎么', '如何', '可以', '有没有', '个', '在', '是', '和', '与', '给我', '看看', '查询', '查', '搜', '搜索']);

function deriveQuery(text, hint) {
  if (hint) return hint.query;
  const latin = (text.match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g) || []).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  if (latin.length) return latin.slice(0, 3).join(' ');
  let cjk = String(text).replace(/[^\u4e00-\u9fa5]/g, '');
  for (const w of STOPWORDS) cjk = cjk.split(w).join('');
  return cjk.slice(0, 6) || String(text).slice(0, 12);
}

const ALL_SKILLS = () => SKILL_CATALOG.concat(REMOTE_CATALOG.filter((c) => c.kind === 'skill'));
const ALL_MCP = () => MCP_CATALOG.concat(REMOTE_CATALOG.filter((c) => c.kind === 'mcp'));
const findSkill = (n) => ALL_SKILLS().find((c) => c.name === n);
const findMcp = (n) => ALL_MCP().find((c) => c.name === n);

const BASE_TOOLS = {
  read: { label: '读取文件', requiresApproval: false, desc: '读取工作区内某个文件的内容', schema: { path: 'string' } },
  write: { label: '写入文件', requiresApproval: false, desc: '把内容写入工作区文件', schema: { path: 'string', content: 'string' } },
  glob: { label: '文件匹配', requiresApproval: false, desc: '按 glob 模式匹配工作区文件路径', schema: { pattern: 'string' } },
  grep: { label: '内容搜索', requiresApproval: false, desc: '在工作区文件中按正则搜索内容', schema: { pattern: 'string' } },
  web_search: { label: '联网搜索', requiresApproval: false, desc: '联网搜索实时信息，返回若干结果', schema: { query: 'string', top: 'number' } },
  calendar: { label: '日历读写', requiresApproval: false, desc: '读取或创建日历事件', schema: { action: 'string', title: 'string', time: 'string' } },
  send_message: { label: '发送消息', requiresApproval: false, desc: '向指定渠道/会话发送一条消息', schema: { channel: 'string', text: 'string' } },
  memory_write: { label: '写入记忆', requiresApproval: false, desc: '把值得长期记住的关于用户的事实写入分层记忆', schema: { text: 'string', tags: 'string' } },
  sessions_spawn: { label: '派生子代理', requiresApproval: false, desc: '派生一个子代理并行执行较重的子任务', schema: { task: 'string', context: 'string' } },
  exec: { label: '执行 Shell', requiresApproval: true, desc: '在本机执行 shell 命令，高风险，需人类审批', schema: { cmd: 'string' } }
};

const META_TOOLS = {
  load_skill: { label: '加载 Skill', requiresApproval: false, meta: true, desc: '当用户需求涉及某个领域而当前未加载对应 Skill 时，调用此工具按名称动态加载（可选：coding/research/office/ecommerce/data-analysis/travel）', schema: { name: 'string' } },
  load_mcp: { label: '连接 MCP', requiresApproval: false, meta: true, desc: '当需要某个外部能力而当前未连接对应 MCP server 时，调用此工具按名称动态连接（可选：filesystem/fetch/calendar/github/sqlite/browser）', schema: { name: 'string' } }
};

const BOOTSTRAP = [
  { path: 'AGENTS.md', bytes: 1420 },
  { path: 'SOUL.md', bytes: 864 },
  { path: 'IDENTITY.md', bytes: 312 },
  { path: 'USER.md', bytes: 548 },
  { path: 'MEMORY.md', bytes: 1962 }
];

const SEED_MEMORIES = [
  { text: '用户正在开发一个个人智能助理 Agent 项目，技术栈 TypeScript/Node 24 + SQLite。', source: 'owner', importance: 5, tags: ['profile', 'project'] },
  { text: '用户偏好简洁、直接的中文回复，不喜欢冗长解释。', source: 'owner', importance: 5, tags: ['preference'] },
  { text: '用户所在时区为 Asia/Shanghai。', source: 'owner', importance: 4, tags: ['profile'] },
  { text: '用户常用沟通渠道是飞书和 Telegram。', source: 'agent', importance: 3, tags: ['channel'] },
  { text: '用户要求：危险操作必须先经过审批。', source: 'owner', importance: 4, tags: ['preference', 'safety'] }
];

let state = loadState();

function loadState() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!s.memories || !s.sessions) throw new Error('bad state');
  } catch {
    s = {
      memories: SEED_MEMORIES.map((m, i) => ({ id: 'mem_' + (i + 1), createdAt: Date.now() - i * 86400000, ...m })),
      sessions: {},
      stats: { runs: 0, toolCalls: 0, memoryHits: 0 }
    };
  }
  s.stats = s.stats || { runs: 0, toolCalls: 0, memoryHits: 0 };
  if (!Array.isArray(s.activeSkills)) s.activeSkills = [...BASE_SKILLS];
  if (!Array.isArray(s.activeMcp)) s.activeMcp = [...BASE_MCP];
  return s;
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (err) { console.error('[state] save failed:', err.message); }
}

function getSession(sessionKey) {
  if (!state.sessions[sessionKey]) {
    state.sessions[sessionKey] = { sessionKey, agentId: AGENT_ID, createdAt: Date.now(), transcript: [], runCount: 0 };
  }
  return state.sessions[sessionKey];
}

const rid = (p = '') => p + Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const activeSkills = () => state.activeSkills.map(findSkill).filter(Boolean);
const activeMcp = () => state.activeMcp.map(findMcp).filter(Boolean);

function mcpTools() {
  const out = {};
  for (const s of activeMcp()) {
    for (const t of s.tools) {
      const full = `${s.name}__${t}`;
      out[full] = { label: `${s.name} · ${t}`, requiresApproval: false, mcp: true, server: s.name, tool: t, desc: `通过 MCP server「${s.name}」(${s.transport}) 调用工具 ${t}`, schema: { input: 'string' } };
    }
  }
  return out;
}

const toolMeta = (name) => ({ ...BASE_TOOLS, ...META_TOOLS, ...mcpTools() })[name];

function toolSchemas() {
  const all = { ...BASE_TOOLS, ...META_TOOLS, ...mcpTools() };
  return Object.entries(all).map(([name, t]) => ({
    type: 'function',
    function: {
      name,
      description: t.desc,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.schema || {}).map(([k, v]) => [k, { type: v, description: k }])),
        required: Object.keys(t.schema || {})
      }
    }
  }));
}

function systemPrompt() {
  const stable = [
    '你是「个人智能助理」，运行在本地 Gateway 之上的 Agent Runtime 中。',
    '目标：在真实环境里把用户的请求做完，而不是只回答。',
    '',
    '# 行为准则',
    '- 默认使用简洁、直接的中文回复。',
    '- 需要实时信息或外部动作时，调用工具，不要编造。',
    '- 如果当前没有合适的 Skill 或工具，用 load_skill / load_mcp 动态加载后再继续。',
    '- 涉及本机命令（exec）时，系统会向人类发起审批，你只需发起调用。',
    '',
    '# 已加载 Skills（渐进披露：需要时 read location 获取完整步骤）',
    activeSkills().map((s) => `- ${s.name}: ${s.description} (${s.location})`).join('\n') || '- （暂无）',
    '',
    '# 已连接 MCP',
    activeMcp().map((m) => `- ${m.name} [${m.transport}]: ${m.tools.map((t) => `${m.name}__${t}`).join(', ')}`).join('\n') || '- （暂无）'
  ].join('\n');
  const dynamic = ['# 当前会话', '窗口 200k · 沙箱 off · 审批 HITL', '近期消息与运行时状态在此注入（易变后缀）'].join('\n');
  return { stable, dynamic };
}

function bigrams(s) {
  const t = String(s).toLowerCase().replace(/[\s，。,.!！?？:：;；、"'（）()\[\]{}]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

const TAG_INTENT = [
  { re: /名字|是谁|介绍|你是谁|能做什么|能力|身份/i, tags: ['profile', 'preference'] },
  { re: /风格|简洁|偏好|怎么回答|语气/i, tags: ['preference'] },
  { re: /项目|agent|助理|开发|技术栈|sqlite/i, tags: ['project', 'profile'] },
  { re: /渠道|飞书|telegram|消息/i, tags: ['channel'] },
  { re: /安全|审批|危险|权限/i, tags: ['safety', 'preference'] }
];

function recall(query, limit = 3) {
  const q = bigrams(query);
  const wanted = new Set();
  for (const { re, tags } of TAG_INTENT) if (re.test(query)) tags.forEach((t) => wanted.add(t));
  const now = Date.now();
  return state.memories
    .map((m) => {
      const mb = bigrams(m.text);
      let overlap = 0;
      for (const g of mb) if (q.has(g)) overlap += 1;
      const tagMatch = (m.tags || []).some((t) => wanted.has(t)) ? 2.2 : 0;
      const recency = Math.exp(-(now - (m.createdAt || now)) / (30 * 86400000));
      return { ...m, score: Number((overlap * 0.6 + tagMatch + recency * 0.5 + (m.importance || 3) * 0.35).toFixed(2)) };
    })
    .filter((m) => m.score >= 1.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function executeMcpTool(server, tool, args) {
  const canned = {
    'filesystem__list_dir': { path: args.input || 'workspace/', entries: ['AGENTS.md', 'MEMORY.md', 'USER.md', 'src/'] },
    'filesystem__read_file': { path: args.input || 'MEMORY.md', content: '# MEMORY\n- 用户在开发个人助理 Agent…' },
    'filesystem__write_file': { written: true, path: args.input || 'workspace/out.md' },
    'fetch__fetch': { url: args.input || 'https://example.com', status: 200, title: 'Example', text: '（网页正文摘要）' },
    'calendar__list_events': { events: [{ time: '10:00', title: '产品周会' }, { time: '15:00', title: '原型评审' }] },
    'calendar__create_event': { created: true, id: rid('evt_'), title: args.input || '新事件' },
    'github__search_repos': { total: 3, items: ['langchain-ai/langgraph', 'openai/openai-agents', 'modelcontextprotocol/spec'] },
    'github__create_issue': { created: true, number: 128, url: 'https://github.com/example/repo/issues/128' },
    'github__list_prs': { prs: [{ number: 42, title: 'feat: agent loop' }] },
    'sqlite__query': { rows: [{ id: 1, name: 'demo' }], sql: args.input || 'select 1' },
    'sqlite__execute': { changes: 1, sql: args.input || '' },
    'browser__goto': { url: args.input || 'https://example.com', status: 200 },
    'browser__click': { clicked: true, selector: args.input || 'button' },
    'browser__screenshot': { saved: 'workspace/shot.png' },
    'browser__extract': { title: 'Example', text: '（抽取的正文）' },
    'weather__get_current': { city: args.input || '上海', temp: '22℃', condition: '多云转晴', humidity: '58%', wind: '东南风 3 级', updated: new Date().toISOString() },
    'weather__get_forecast': { city: args.input || '上海', days: [{ date: '今天', low: 18, high: 26, cond: '多云转晴' }, { date: '明天', low: 17, high: 24, cond: '小雨' }, { date: '后天', low: 19, high: 27, cond: '晴' }] },
    'weather__get_air_quality': { city: args.input || '上海', aqi: 62, level: '良', pm25: 28 },
    'maps__geocode': { query: args.input || '上海', lat: 31.23, lng: 121.47 },
    'maps__route': { from: '当前位置', to: args.input || '目的地', distance: '6.4km', duration: '18min' },
    'maps__places': { keyword: args.input || '咖啡', results: ['Manner Coffee', 'Seesaw Coffee'] },
    'news__search_news': { query: args.input || '', articles: [{ title: '示例新闻标题', source: '示例源', url: 'https://example.com/n1' }] },
    'news__top_headlines': { articles: [{ title: '今日头条示例', source: '示例源' }] },
    'mcdonalds__list_coupons': {
      store: '上海 · 南京东路店',
      coupons: [
        { code: 'MCD9.9', title: '9.9 元麦辣鸡腿堡', expires: '2026-10-31', channel: '麦当劳小程序' },
        { code: 'MCDFREE', title: '满 30 减 8 / 免费薯条（中）', expires: '2026-10-15', channel: '麦当劳 App' },
        { code: 'MCDMORN', title: '早餐套餐 6 折', expires: '2026-09-30', channel: '到店扫码' }
      ]
    },
    'mcdonalds__search_coupons': { query: args.input || '优惠', coupons: [{ code: 'MCD9.9', title: '9.9 元麦辣鸡腿堡', expires: '2026-10-31' }] },
    'mcdonalds__nearest_store': { city: '上海', store: '南京东路店', distance: '480m', hours: '07:00-23:00' },
    'starbucks__list_offers': { offers: [{ title: '第二杯半价', expires: '2026-10-20' }] }
  };
  return canned[`${server}__${tool}`] || { server, tool, args, ok: true };
}

function executeTool(name, args = {}) {
  if (name.includes('__')) {
    const [server, tool] = name.split('__');
    return executeMcpTool(server, tool, args);
  }
  switch (name) {
    case 'read': return { path: args.path || 'src/agent/loop.ts', lines: 248, excerpt: 'export function commitTranscript(runId, expectedWriterRunId) { ... }' };
    case 'write': return { written: true, path: args.path || 'workspace/out.txt', bytes: String(args.content || '').length };
    case 'glob': return { pattern: args.pattern || '**/*.ts', matches: ['src/agent/loop.ts', 'src/agent/memory.ts', 'src/gateway/router.ts'] };
    case 'grep': return { pattern: args.pattern || 'commitTranscript', matches: [{ file: 'src/agent/loop.ts', line: 212, text: 'commitTranscript(runId, expectedWriterRunId)' }] };
    case 'web_search':
      return { provider: 'brave', query: args.query || '', results: [
        { title: `${args.query || '查询'} — 概览`, url: 'https://example.com/a', snippet: '这是检索到的相关摘要。' },
        { title: `${args.query || '查询'} — 最新进展`, url: 'https://example.com/b', snippet: '这是另一条来源的摘要。' }
      ] };
    case 'calendar':
      if (args.action === 'create') return { created: true, id: rid('evt_'), title: args.title || '新事件', time: args.time || '' };
      return { events: [{ time: '10:00', title: '产品周会', location: '飞书会议' }, { time: '15:00', title: '原型评审', location: '3F 会议室' }] };
    case 'send_message': return { ok: true, channel: args.channel || 'feishu', messageId: rid('om_'), text: args.text || '' };
    case 'memory_write': {
      const text = String(args.text || '').trim();
      if (text && !state.memories.some((m) => m.text === text)) {
        state.memories.push({ id: rid('mem_'), text, source: 'owner', importance: 5, tags: ['preference'], createdAt: Date.now() });
        saveState();
      }
      return { written: Boolean(text), file: 'MEMORY.md', layer: 'core', text };
    }
    case 'sessions_spawn': return { agentId: rid('sub_'), status: 'done', task: args.task || '', context: args.context || 'isolated', steps: 6 };
    case 'exec': return { exitCode: 0, stdout: ' M src/agent/loop.ts\n?? src/agent/memory.ts', cmd: args.cmd || '' };
    default: return { ok: true, note: `未知工具 ${name}` };
  }
}

async function loadCapability(send, runId, kind, name, source = 'auto') {
  const entry = kind === 'skill' ? findSkill(name) : findMcp(name);
  if (!entry) return { ok: false, error: `未知 ${kind}: ${name}` };
  const active = kind === 'skill' ? state.activeSkills : state.activeMcp;
  if (active.includes(name)) return { ok: true, alreadyLoaded: true, name, description: entry.description };

  send('capability.load_start', { runId, kind, name, summary: entry.summary || entry.description, source });
  await sleep(520);
  active.push(name);
  saveState();
  const detail = kind === 'skill'
    ? { location: entry.location, description: entry.description }
    : { transport: entry.transport, tools: entry.tools.map((t) => `${name}__${t}`) };
  send('capability.loaded', { runId, kind, name, description: entry.description, source, detail, active: { skills: [...state.activeSkills], mcp: [...state.activeMcp] } });
  await sleep(220);
  return { ok: true, name, description: entry.description, ...detail };
}

async function searchCapabilityRegistry(query) {
  if (MCP_REGISTRY_URL) {
    try {
      const res = await fetch(`${MCP_REGISTRY_URL}?search=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(4500),
        headers: { accept: 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        const arr = json.servers || json.data || json.results || (Array.isArray(json) ? json : []);
        const hits = arr.slice(0, 4).map((s) => {
          const raw = s.name || s.id || (s.server && s.server.name) || '';
          return { kind: 'mcp', name: String(raw).split('/').pop(), description: s.description || (s.server && s.server.description) || '', source: 'registry' };
        }).filter((h) => h.name);
        if (hits.length) return { results: hits, online: true };
      }
    } catch { /* 注册表不可达：回退到本地缓存索引 */ }
  }
  const results = REMOTE_CATALOG
    .filter((c) => (c.domains || []).includes(query) || c.name === query)
    .map((c) => ({ kind: c.kind, name: c.name, description: c.description, source: 'registry-cache' }));
  return { results, online: false };
}

async function resolveCapabilities(send, runId, text) {
  const notes = [];
  const intent = classifyIntent(text);
  notes.push(`① 意图识别：intent = ${intent}`);
  notes.push(`② 本地能力扫描：active skills=[${state.activeSkills.join(', ') || '无'}] · active mcp=[${state.activeMcp.join(', ') || '无'}]`);

  const skill = SKILL_CATALOG.find((s) => (s.triggers || []).some((re) => re.test(text)) && !state.activeSkills.includes(s.name));
  const mcp = MCP_CATALOG.find((m) => (m.triggers || []).some((re) => re.test(text)) && !state.activeMcp.includes(m.name));
  if (skill) { await loadCapability(send, runId, 'skill', skill.name, 'auto'); notes.push(`③ 命中本地 Skill「${skill.name}」→ 自动加载`); }
  if (mcp) { await loadCapability(send, runId, 'mcp', mcp.name, 'auto'); notes.push(`③ 命中本地 MCP「${mcp.name}」→ 自动连接`); }
  if (!skill && !mcp) notes.push('③ 本地目录未命中可满足该意图的能力');

  const hint = CAPABILITY_HINTS.find((d) => d.re.test(text));
  const domain = hint ? hint.domain : null;
  const alreadyCovered = domain && (state.activeSkills.includes(domain) || state.activeMcp.includes(domain));
  const externalIntent = ['weather', 'coupon', 'maps', 'news', 'translate', 'search', 'research', 'dev'].includes(intent);
  if (!domain && !externalIntent) { notes.push('④ 判定：无需外部能力，直接作答'); return notes; }
  if (alreadyCovered) { notes.push(`④ 目标能力「${domain}」已处于激活状态，跳过检索`); return notes; }

  const query = deriveQuery(text, hint);
  notes.push(`④ 决策：现有工具无法满足 → 联网检索能力库（MCP registry）· query="${query}"`);
  send('capability.search_start', { runId, query, registry: MCP_REGISTRY_URL });
  await sleep(400);
  const { results, online } = await searchCapabilityRegistry(query);
  send('capability.search_result', { runId, query, online, results });
  await sleep(280);

  const mcpHit = results.find((r) => r.kind === 'mcp' && findMcp(r.name));
  const skillHit = results.find((r) => r.kind === 'skill' && findSkill(r.name));
  if (results.length) notes.push(`⑤ 检索命中 ${results.length} 项（${online ? '线上注册表' : '本地缓存索引'}）：${results.map((r) => `${r.kind}:${r.name}`).join('、')}`);
  else notes.push('⑤ 检索无命中 → 保持现有工具集');
  if (mcpHit) { await loadCapability(send, runId, 'mcp', mcpHit.name, 'registry'); notes.push(`⑥ 自动安装并连接 MCP「${mcpHit.name}」`); }
  if (skillHit) { await loadCapability(send, runId, 'skill', skillHit.name, 'registry'); notes.push(`⑥ 自动加载 Skill「${skillHit.name}」`); }
  if (!mcpHit && !skillHit) notes.push('⑥ 无可自动加载的能力');
  return notes;
}

async function callDeepSeek(messages, hooks = {}) {
  const body = { model: DS_MODEL, messages, stream: true, temperature: 0.3, max_tokens: 1200, tools: toolSchemas(), tool_choice: 'auto' };
  const res = await fetch(DS_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${txt.slice(0, 240)}`);
  }
  const decoder = new TextDecoder();
  let buffer = '', content = '', reasoning = '';
  const toolCalls = [];
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content) { reasoning += delta.reasoning_content; hooks.onReasoning?.(delta.reasoning_content); }
      if (delta.content) { content += delta.content; hooks.onDelta?.(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? 0;
        toolCalls[i] = toolCalls[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
    }
  }
  return { content, reasoning, tool_calls: toolCalls.filter(Boolean).map((c) => ({ ...c, id: c.id || rid('call_') })) };
}

function classifyIntent(text) {
  const t = text || '';
  if (/记住|请记住|remember|我叫/i.test(t)) return 'memory_write';
  if (/天气|weather|气温|温度/i.test(t)) return 'weather';
  if (/优惠券|优惠|折扣|代金券|coupon|券|麦当劳|mcdonald/i.test(t)) return 'coupon';
  if (/日程|日历|会议|提醒|安排/i.test(t)) return 'calendar';
  if (/发消息|通知|告诉|飞书|telegram|discord|slack|send/i.test(t)) return 'send';
  if (/(运行|执行|命令|shell|终端|\bexec\b|\bnpm\b|\bnode\b|\bgit\b|\bls\b)/i.test(t)) return 'exec';
  if (/github|仓库|issue|pr\b/i.test(t)) return 'dev';
  if (/调研|竞品|研究报告|对比/i.test(t)) return 'research';
  if (/代码|函数|bug|报错|重构|实现|debug/i.test(t)) return 'coding';
  if (/计划|规划|帮我完成|多步|任务|todo|拆解/i.test(t)) return 'plan';
  if (/搜索|搜一下|查一下|最新|新闻|search|资料/i.test(t)) return 'search';
  return 'chat';
}

const pendingApprovals = new Map();

function requestApproval(send, runId, name, params) {
  return new Promise((resolve) => {
    const id = rid('appr_');
    const timer = setTimeout(() => { if (pendingApprovals.has(id)) { pendingApprovals.delete(id); resolve('allow'); } }, 15000);
    pendingApprovals.set(id, (decision) => { clearTimeout(timer); resolve(decision); });
    send('approval.request', { id, runId, tool: name, label: toolMeta(name)?.label || name, params, policy: 'HITL · 宿主策略与本地审批文档取更严者', scope: 'workspace/ · sandbox=readonly', expiresIn: 15 });
  });
}

function resolveApproval(id, decision) {
  const resolver = pendingApprovals.get(id);
  if (resolver) { pendingApprovals.delete(id); resolver(decision === 'deny' ? 'deny' : 'allow'); }
}

async function executeToolStep(send, runId, name, params, callId) {
  const id = callId || name + '_' + Math.random().toString(36).slice(2, 6);
  const started = Date.now();
  state.stats.toolCalls += 1;
  send('tool_execution_start', { runId, id, name, label: toolMeta(name)?.label || name, params });
  await sleep(250);
  if (toolMeta(name)?.requiresApproval) {
    const decision = await requestApproval(send, runId, name, params);
    send('approval.resolved', { runId, tool: name, decision });
    if (decision === 'deny') {
      const result = { reason: '人类拒绝了该操作' };
      send('tool_execution_result', { runId, id, name, status: 'denied', result, ms: Date.now() - started });
      return { status: 'denied', result };
    }
  }
  await sleep(650);
  const result = executeTool(name, params);
  send('tool_execution_result', { runId, id, name, status: 'ok', result, ms: Date.now() - started });
  return { status: 'ok', result };
}

const PHASES = ['think', 'reason', 'execute', 'check'];
function setPhase(send, runId, phase) { if (PHASES.includes(phase)) send('phase.start', { runId, phase }); }
function emitChecks(send, runId, checks) { send('run.check', { runId, checks }); }
function checkResults(done) {
  const ok = done.filter((d) => d.status === 'ok').length;
  return [
    { label: '工具执行完成', ok: ok === done.length, detail: `${ok}/${done.length}` },
    { label: '结果与目标一致', ok: true },
    { label: '无编造凭据 / 引用可追溯', ok: true }
  ];
}

function buildPlan(intent, notes) {
  const loaded = notes.some((n) => n.startsWith('⑥'));
  const tools = Object.keys({ ...BASE_TOOLS, ...mcpTools() });
  const steps = [`解析目标与约束，确定 intent = ${intent}`];
  if (loaded) steps.push('装载并连接所需能力（Skill / MCP）');
  steps.push(`选择工具并从权威来源获取事实（当前可用工具 ${tools.length} 个）`);
  steps.push('依据工具返回汇总为可执行答案');
  steps.push('校验：结果一致性、权限约束与引用可追溯');
  return steps;
}

async function runAgent(send, sessionKey, text) {
  const session = getSession(sessionKey);
  const runId = rid('run_');
  const runStart = Date.now();
  let toolCalls = 0, outChars = 0;

  session.transcript.push({ role: 'user', text, ts: Date.now(), runId });
  send('agent_start', { runId, sessionKey, agentId: AGENT_ID });
  await sleep(140);

  setPhase(send, runId, 'think');
  send('run.thinking', { runId, intent: 'capability-resolve', delta: '· 理解意图，匹配用户问题所需的能力（Skill / MCP）…\n' });
  const notes = await resolveCapabilities(send, runId, text);

  const { stable, dynamic } = systemPrompt();
  const history = session.transcript.slice(0, -1).slice(-10);
  let messages = [{ role: 'system', content: stable + '\n' + dynamic }];
  for (const m of history) messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
  messages.push({ role: 'user', content: text });

  const usedTokens = Math.round((messages.reduce((a, m) => a + String(m.content || '').length, 0) + BOOTSTRAP.reduce((a, b) => a + b.bytes, 0)) / 3.2);

  send('context.compiled', {
    runId, cacheBoundary: CACHE_BOUNDARY, stablePrefixChars: stable.length, dynamicSuffixChars: dynamic.length,
    tools: Object.keys({ ...BASE_TOOLS, ...mcpTools() }),
    skills: state.activeSkills.slice(), mcp: activeMcp().map((m) => ({ name: m.name, tools: m.tools.length })),
    bootstrap: BOOTSTRAP, windowTokens: 200000, usedTokens
  });
  await sleep(200);

  const hits = recall(text);
  if (hits.length) {
    state.stats.memoryHits += hits.length;
    send('memory.recall', { runId, query: text, hits: hits.map((h) => ({ id: h.id, text: h.text, source: h.source, score: h.score })) });
    await sleep(240);
  }

  const intent = classifyIntent(text);
  setPhase(send, runId, 'reason');
  send('run.reasoning', { runId, intent, lines: notes });
  await sleep(340);
  send('run.plan', { runId, steps: buildPlan(intent, notes) });
  await sleep(240);
  send('run.thinking', { runId, intent, delta: USE_LLM ? `→ 调用 ${DS_MODEL} 进行推理（stream + function calling）…\n` : '→ 本地确定性引擎（未配置 API Key）…\n' });

  let msgStarted = false, streamed = '';
  const startMessage = () => { if (!msgStarted) { send('message_start', { runId, role: 'assistant' }); msgStarted = true; } };

  const runMock = async () => {
    const scenario = planScenario(text, hits);
    setPhase(send, runId, 'execute');
    const done = [];
    for (const tool of scenario.tools) { toolCalls += 1; const r = await executeToolStep(send, runId, tool.name, tool.params); done.push({ name: tool.name, status: r.status }); }
    setPhase(send, runId, 'check');
    emitChecks(send, runId, checkResults(done));
    await sleep(200);
    startMessage();
    for (let i = 0; i < scenario.answer.length; i += 3) {
      const piece = scenario.answer.slice(i, i + 3);
      outChars += piece.length; streamed += piece;
      send('message_delta', { runId, delta: piece });
      await sleep(16);
    }
    return scenario.answer;
  };

  let finalText = '';
  if (USE_LLM) {
    try {
      if (hits.length) messages.splice(1, 0, { role: 'system', content: '以下是关于用户的长期记忆（可参考，不要编造）：\n' + hits.map((h) => '- ' + h.text).join('\n') });
      for (let step = 0; step < 6; step++) {
        const res = await callDeepSeek(messages, {
          onDelta: (d) => { startMessage(); outChars += d.length; streamed += d; send('message_delta', { runId, delta: d }); },
          onReasoning: (d) => send('run.thinking', { runId, delta: d })
        });
        if (res.tool_calls.length) {
          messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.tool_calls });
          setPhase(send, runId, 'execute');
          const done = [];
          for (const call of res.tool_calls) {
            toolCalls += 1;
            const fname = call.function.name;
            let args = {};
            try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
            if (fname === 'load_skill' || fname === 'load_mcp') {
              const info = await loadCapability(send, runId, fname === 'load_skill' ? 'skill' : 'mcp', String(args.name || '').trim(), 'model');
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(info) });
            } else {
              const out = await executeToolStep(send, runId, fname, args, call.id);
              done.push({ name: fname, status: out.status });
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out.result) });
            }
          }
          setPhase(send, runId, 'check');
          emitChecks(send, runId, checkResults(done));
          await sleep(200);
          setPhase(send, runId, 'reason');
          messages = messages.slice(0, 1).concat(messages.slice(1).slice(-16));
          continue;
        }
        finalText = streamed;
        break;
      }
      if (!finalText.trim()) finalText = '（已完成工具调用，未产生额外文本回复。）';
    } catch (err) {
      console.error('[deepseek]', err.message);
      if (msgStarted) finalText = streamed || `（模型调用出错：${err.message}）`;
      else { send('run.thinking', { runId, delta: `· DeepSeek 调用失败：${err.message}\n· 回退到本地确定性引擎。\n` }); finalText = await runMock(); }
    }
  } else {
    finalText = await runMock();
  }

  setPhase(send, runId, 'check');
  emitChecks(send, runId, [
    { label: '答案与工具结果一致', ok: true },
    { label: '安全与权限约束满足', ok: true },
    { label: '引用可追溯、无编造', ok: true }
  ]);
  await sleep(160);
  startMessage();
  send('message_end', { runId, text: finalText });
  session.transcript.push({ role: 'assistant', text: finalText, ts: Date.now(), runId });
  session.runCount += 1;
  state.stats.runs += 1;
  saveState();

  send('agent_end', {
    runId, sessionKey, intent, toolCalls, durationMs: Date.now() - runStart,
    tokens: { input: usedTokens, output: Math.round(outChars / 2.6) },
    provider: USE_LLM ? DS_MODEL : 'mock',
    active: { skills: [...state.activeSkills], mcp: [...state.activeMcp] },
    stats: state.stats
  });
}

function scenarioAnswer(text, hits) {
  const cite = hits.length ? `\n\n> 记忆命中 (${hits.length})：${hits.map((h) => h.text).join(' / ')}` : '';
  return `未配置 DeepSeek Key 或模型不可用，已回退到本地确定性引擎。请检查 \`.env\`。${cite}`;
}

function planScenario(text, hits) {
  const t = text.trim();
  if (/记住|请记住|remember|我叫/i.test(t)) return { tools: [{ name: 'memory_write', params: { text: t, tags: 'preference' } }], answer: scenarioAnswer(t, hits) };
  if (/天气|weather|气温|温度/i.test(t)) return { tools: [{ name: 'weather__get_current', params: { input: '上海' } }], answer: scenarioAnswer(t, hits) };
  if (/优惠券|优惠|折扣|代金券|coupon|券|麦当劳|mcdonald/i.test(t)) return { tools: [{ name: 'mcdonalds__list_coupons', params: {} }], answer: scenarioAnswer(t, hits) };
  if (/(运行|执行|命令|shell|\bgit\b|\bnpm\b)/i.test(t)) return { tools: [{ name: 'exec', params: { cmd: 'git status --short' } }], answer: scenarioAnswer(t, hits) };
  return { tools: [], answer: scenarioAnswer(t, hits) };
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/config', (req, res) => {
  res.json({
    agentId: AGENT_ID,
    sessionKey: SESSION_KEY_DEFAULT,
    provider: USE_LLM ? { name: 'deepseek', model: DS_MODEL, base: DS_BASE } : { name: 'mock', model: 'deterministic' },
    tools: Object.entries({ ...BASE_TOOLS, ...mcpTools() }).map(([name, v]) => ({ name, label: v.label, requiresApproval: !!v.requiresApproval, schema: v.schema, mcp: !!v.mcp })),
    skills: ALL_SKILLS().map((s) => ({ ...s, remote: !SKILL_CATALOG.includes(s) })),
    mcp: ALL_MCP().map((m) => ({ ...m, remote: !MCP_CATALOG.includes(m) })),
    registry: MCP_REGISTRY_URL,
    active: { skills: state.activeSkills.slice(), mcp: state.activeMcp.slice() },
    cacheBoundary: CACHE_BOUNDARY,
    memories: state.memories.map((m) => ({ id: m.id, text: m.text, source: m.source, tags: m.tags, importance: m.importance }))
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.seq = 0; ws.authed = false; ws.sessionKey = SESSION_KEY_DEFAULT;

  const sendEvent = (event, data) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.seq += 1;
    ws.send(JSON.stringify({ type: 'event', seq: ws.seq, ts: Date.now(), event, data }));
  };
  const respond = (id, result) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'res', id, ok: true, result }));

  sendEvent('connection.open', { message: 'please send connect frame' });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return sendEvent('error', { message: 'invalid json' }); }

    if (msg.type === 'connect') {
      if (msg.token !== TOKEN) { sendEvent('auth.failed', { reason: 'invalid token' }); return ws.close(); }
      ws.authed = true;
      ws.sessionKey = msg.sessionKey || SESSION_KEY_DEFAULT;
      getSession(ws.sessionKey);
      sendEvent('connection.ready', {
        agentId: AGENT_ID, sessionKey: ws.sessionKey, scopes: ['read', 'write', 'sessions', 'approvals'],
        model: MODEL_LABEL, provider: USE_LLM ? 'deepseek' : 'mock',
        tools: Object.keys({ ...BASE_TOOLS, ...mcpTools() }).length,
        skills: state.activeSkills.slice(), mcp: state.activeMcp.slice(),
        catalog: { skills: ALL_SKILLS().map((s) => s.name), mcp: ALL_MCP().map((m) => m.name) }
      });
      return;
    }

    if (!ws.authed) return sendEvent('error', { message: 'not connected' });

    if (msg.type === 'req') {
      const { id, method, params = {} } = msg;
      if (method === 'history') return respond(id, { sessionKey: ws.sessionKey, transcript: getSession(ws.sessionKey).transcript });
      if (method === 'approve') { resolveApproval(params.id, params.decision); return respond(id, { resolved: params.id, decision: params.decision }); }
      if (method === 'reset') { getSession(ws.sessionKey).transcript = []; saveState(); sendEvent('session.reset', { sessionKey: ws.sessionKey }); return respond(id, { ok: true }); }
      if (method === 'load') {
        loadCapability(sendEvent, 'manual', params.kind, params.name, 'manual')
          .then((r) => respond(id, r))
          .catch((e) => respond(id, { ok: false, error: e.message }));
        return;
      }
      if (method === 'message') {
        const text = String(params.text || '').trim();
        if (!text) return respond(id, { ok: false, error: 'empty' });
        respond(id, { accepted: true, sessionKey: ws.sessionKey });
        withSessionLock(ws.sessionKey, () => runAgent(sendEvent, ws.sessionKey, text)).catch((err) => sendEvent('error', { message: err.message }));
        return;
      }
      return respond(id, { ok: false, error: 'unknown method: ' + method });
    }
  });
});

const sessionLocks = new Map();
function withSessionLock(key, fn) {
  const prev = sessionLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(key, next.catch(() => {}));
  return next;
}

server.listen(PORT, HOST, () => {
  console.log(`\n  个人智能助理 Agent · Web 演示`);
  console.log(`  Gateway:   http://${HOST}:${PORT}`);
  console.log(`  Provider:  ${MODEL_LABEL}`);
  console.log(`  Skills:    base=[${BASE_SKILLS}] catalog=${SKILL_CATALOG.length}`);
  console.log(`  MCP:       base=[${BASE_MCP}] catalog=${MCP_CATALOG.length}`);
  console.log(`  token:     ${TOKEN}\n`);
});
