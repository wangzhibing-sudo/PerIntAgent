const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const TOKEN = 'demo-token';

const els = {
  messages: document.getElementById('messages'),
  welcome: document.getElementById('welcome'),
  trace: document.getElementById('trace'),
  traceCount: document.getElementById('trace-count'),
  suggestions: document.getElementById('suggestions'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  conn: document.getElementById('pill-conn'),
  model: document.getElementById('pill-model'),
  session: document.getElementById('pill-session'),
  tools: document.getElementById('pill-tools'),
  skills: document.getElementById('pill-skills'),
  mcp: document.getElementById('pill-mcp'),
  capSkills: document.getElementById('cap-skills'),
  capMcp: document.getElementById('cap-mcp')
};

let ws = null;
let authed = false;
let traceCount = 0;
let connectedAt = 0;
let currentRun = null;
const runs = new Map();

const SUGGESTIONS = [
  '帮我查一下上海今天的天气',
  '记住我偏好简洁的中文回复',
  '明天下午3点安排产品评审',
  '帮我做一份竞品调研',
  '搜索最新的 Agent 框架趋势',
  '运行 git status'
];

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function connect() {
  setConn('connecting');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'connect', token: TOKEN, client: 'web-demo', sessionKey: 'agent:main:web:demo' }));
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'event') handleEvent(msg);
    else if (msg.type === 'res') handleRes(msg);
  };

  ws.onclose = () => {
    authed = false;
    setConn('offline');
    setTimeout(connect, 1500);
  };

  ws.onerror = () => { try { ws.close(); } catch {} };
}

function setConn(state) {
  els.conn.classList.remove('online', 'offline');
  const v = els.conn.querySelector('.pv');
  if (state === 'online') { els.conn.classList.add('online'); v.textContent = 'Gateway 已连接'; }
  else if (state === 'offline') { els.conn.classList.add('offline'); v.textContent = '连接断开，重连中…'; }
  else v.textContent = '连接中…';
}

function handleRes(msg) {
  if (msg.result && msg.result.sessionKey) els.session.textContent = msg.result.sessionKey.split(':').slice(-2).join(':');
}

function request(method, params) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'req', id: 'c_' + Math.random().toString(36).slice(2, 9), method, params }));
}

function handleEvent(m) {
  const { event, data } = m;
  addTrace(event, data);
  switch (event) {
    case 'connection.ready': onReady(data); break;
    case 'auth.failed':
    case 'error': addErrorNotice(data); break;
    case 'agent_start': startRun(data); break;
    case 'phase.start': setPhase(data); break;
    case 'run.check': addCheck(data); break;
    case 'run.reasoning': addReasoning(data); break;
    case 'run.plan': addPlan(data); break;
    case 'context.compiled': addContext(data); break;
    case 'memory.recall': addMemory(data); break;
    case 'run.thinking': addThinking(data); break;
    case 'tool_execution_start': addToolStart(data); break;
    case 'tool_execution_result': addToolResult(data); break;
    case 'approval.request': addApproval(data); break;
    case 'approval.resolved': onApprovalResolved(data); break;
    case 'capability.load_start': addCapStart(data); break;
    case 'capability.loaded': addCapDone(data); break;
    case 'capability.search_start': addSearchStart(data); break;
    case 'capability.search_result': addSearchResult(data); break;
    case 'message_start': startMessage(data); break;
    case 'message_delta': deltaMessage(data); break;
    case 'message_end': endMessage(data); break;
    case 'agent_end': endRun(data); break;
    case 'session.reset': resetUI(); break;
  }
}

function onReady(d) {
  authed = true;
  connectedAt = Date.now();
  setConn('online');
  els.model.textContent = (d.model || '').split('·')[0].replace('primary:', '').trim() || 'primary';
  els.model.title = d.model || '';
  els.session.textContent = (d.sessionKey || '').split(':').slice(-2).join(':');
  els.tools.textContent = d.tools;
  renderCaps(d.skills, d.mcp);
}

/* ---------- run rendering ---------- */

const PHASE_LABEL = { think: '思考', reason: '推理', execute: '执行', check: '检查' };
const PHASE_ORDER = ['think', 'reason', 'execute', 'check'];

function startRun(d) {
  if (els.welcome) { els.welcome.remove(); els.welcome = null; }
  const run = { id: d.runId, steps: [], toolEls: new Map(), phase: 'think' };
  run.el = el('div', 'run');
  run.phasesEl = el('div', 'phases');
  PHASE_ORDER.forEach((p, i) => {
    const node = el('div', 'phase');
    node.dataset.p = p;
    node.innerHTML = `<span class="ph-idx">${i + 1}</span><span class="ph-name">${PHASE_LABEL[p]}</span>`;
    run.phasesEl.appendChild(node);
  });
  run.stepsEl = el('div', 'steps');
  run.el.appendChild(run.phasesEl);
  run.el.appendChild(run.stepsEl);
  els.messages.appendChild(run.el);
  runs.set(d.runId, run);
  currentRun = run;
  setPhase({ runId: d.runId, phase: 'think' });
  scrollDown();
}

function setPhase(d) {
  const run = runs.get(d.runId) || currentRun; if (!run) return;
  run.phase = d.phase;
  run.phasesEl.querySelectorAll('.phase').forEach((node) => {
    const p = node.dataset.p;
    node.classList.toggle('active', p === d.phase);
    if (p === d.phase) node.classList.add('visited');
    else node.classList.remove('active');
  });
  if (d.phase === 'check' && run.planStep) {
    run.planStep.body.querySelectorAll('.plan-step').forEach((n) => n.classList.add('done'));
  }
}

function appendStep(run, kind, tag, title, meta) {
  const step = el('div', 'step ' + kind);
  step.dataset.phase = run.phase || 'think';
  const head = el('div', 'step-head');
  if (kind === 'tool' || kind === 'capability' || kind === 'search') head.appendChild(el('div', 'spinner'));
  head.appendChild(el('span', 'tag', esc(tag)));
  head.appendChild(el('span', 'title', esc(title)));
  head.appendChild(el('span', 'meta', esc(meta || '')));
  const body = el('div', 'step-body');
  step.appendChild(head);
  step.appendChild(body);
  run.stepsEl.appendChild(step);
  scrollDown();
  return { step, head, body, metaEl: head.querySelector('.meta') };
}

function addContext(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'context', 'context', '上下文组装 · 稳定前缀 + cache boundary', `${d.usedTokens}/${d.windowTokens} tok`);
  s.body.innerHTML =
    `<span class="kv">cacheBoundary</span> ${esc(d.cacheBoundary)}\n` +
    `<span class="kv">stablePrefix</span> ${d.stablePrefixChars} chars · <span class="kv">dynamicSuffix</span> ${d.dynamicSuffixChars} chars\n` +
    `<span class="kv">tools</span> ${esc(d.tools.join(', '))}\n` +
    `<span class="kv">skills</span> ${esc(d.skills.join(', '))}\n` +
    `<span class="kv">mcp</span> ${d.mcp.map((x) => `${x.name}(${x.tools})`).join(' · ')}\n` +
    `<span class="kv">bootstrap</span> ${d.bootstrap.map((b) => `${b.path} ${b.bytes}B`).join(' · ')}`;
}

function addMemory(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'memory', 'memory', '记忆召回 · Lane 1 排名搜索', `${d.hits.length} 命中`);
  s.body.innerHTML = d.hits.map((h) =>
    `[${h.source}] score=${h.score}  <span class="hit">${esc(h.text)}</span>`
  ).join('\n');
}

function addThinking(d) {
  const run = currentRun; if (!run) return;
  if (d.intent && (!run.think || run.thinkIntent !== d.intent)) {
    run.think = appendStep(run, 'think', 'think', `推理规划 · intent=${d.intent}`, '');
    run.thinkIntent = d.intent;
  }
  if (!run.think) run.think = appendStep(run, 'think', 'think', '推理', '');
  if (d.delta) {
    run.think.body.textContent += d.delta;
    scrollDown();
  }
}

function addCapStart(d) {
  const run = currentRun; if (!run) return;
  const tag = d.kind === 'skill' ? 'skill' : 'mcp';
  const title = `动态加载 ${d.kind === 'skill' ? 'Skill' : 'MCP'}：${d.name}`;
  const s = appendStep(run, 'capability', tag, title, 'loading…');
  s.body.textContent = `source=${d.source}\n${d.summary || ''}`;
  run.caps = run.caps || new Map();
  run.caps.set(d.kind + ':' + d.name, s);
  scrollDown();
}

function addCapDone(d) {
  const run = currentRun;
  const s = run && run.caps && run.caps.get(d.kind + ':' + d.name);
  if (s) {
    s.step.classList.add('ok');
    s.metaEl.textContent = 'loaded';
    s.body.textContent = JSON.stringify(d.detail || {}, null, 2);
  }
  if (d.active) renderCaps(d.active.skills, d.active.mcp, d.kind + ':' + d.name);
}

function renderCaps(skills, mcp, newKey) {
  fillChips(els.capSkills, skills, 'skill', newKey);
  fillChips(els.capMcp, mcp, 'mcp', newKey);
  els.skills.textContent = (skills || []).length;
  els.mcp.textContent = (mcp || []).length;
}

function fillChips(container, list, kind, newKey) {
  container.innerHTML = '';
  (list || []).forEach((n) => {
    const isNew = newKey === kind + ':' + n;
    container.appendChild(el('span', 'cap-chip' + (isNew ? ' new' : ''), esc(n)));
  });
}

function addReasoning(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'reasoning', 'reason', `推理逻辑 · intent=${d.intent}`, `${(d.lines || []).length} 条判定`);
  s.body.innerHTML = (d.lines || []).map((l) => esc(l)).join('\n');
  scrollDown();
}

function addPlan(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'plan', 'plan', '执行计划 · Plan', `${(d.steps || []).length} 步`);
  s.body.innerHTML = (d.steps || []).map((st, i) => `<div class="plan-step"><span class="plan-n">${i + 1}</span> ${esc(st)}</div>`).join('');
  run.planStep = s;
  scrollDown();
}

function addCheck(d) {
  const run = currentRun; if (!run) return;
  const checks = d.checks || [];
  const ok = checks.filter((c) => c.ok).length;
  const s = appendStep(run, 'check', 'check', '检查 · 结果校验与对齐目标', `${ok}/${checks.length} 通过`);
  s.head.querySelector('.spinner')?.remove();
  s.step.classList.add(ok === checks.length ? 'ok' : 'denied');
  s.body.innerHTML = checks.map((c) =>
    `<span class="${c.ok ? 'chk-ok' : 'chk-err'}">${c.ok ? '✓' : '✗'}</span> ${esc(c.label)}${c.detail ? ` <span class="kv">${esc(c.detail)}</span>` : ''}`
  ).join('\n');
  scrollDown();
}

function addSearchStart(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'search', 'registry', `联网检索能力库 · query="${d.query}"`, 'searching…');
  s.body.textContent = `registry: ${d.registry || '(none)'}\n在 MCP / Skill 注册表中查找现成可用的能力…`;
  run.search = s;
  scrollDown();
}

function addSearchResult(d) {
  const run = currentRun; if (!run) return;
  const s = run.search || appendStep(run, 'search', 'registry', `联网检索能力库 · query="${d.query}"`, '');
  run.search = null;
  s.head.querySelector('.spinner')?.remove();
  const results = d.results || [];
  s.metaEl.textContent = `${results.length} 命中 · ${d.online ? '线上注册表' : '本地缓存'}`;
  s.step.classList.add(results.length ? 'ok' : 'denied');
  s.body.innerHTML = results.length
    ? results.map((r) => `[${r.kind}] <span class="hit">${esc(r.name)}</span> — ${esc(r.description || '')} <span class="kv">(${r.source})</span>`).join('\n')
    : '未找到可直接复用的能力，保持现有工具集。';
  scrollDown();
}

function addToolStart(d) {
  const run = currentRun; if (!run) return;
  const s = appendStep(run, 'tool', 'tool', d.label || d.name, 'running…');
  s.body.textContent = JSON.stringify(d.params);
  run.toolEls.set(d.id, s);
  scrollDown();
}

function addToolResult(d) {
  const run = currentRun; if (!run) return;
  const s = run.toolEls.get(d.id);
  if (!s) return;
  const ok = d.status === 'ok';
  s.step.classList.add(ok ? 'ok' : 'denied');
  s.metaEl.textContent = ok ? `${d.ms}ms · ok` : `${d.status}`;
  s.body.textContent = JSON.stringify(d.result, null, 2);
  scrollDown();
}

function addApproval(d) {
  const run = currentRun; if (!run) return;
  const step = el('div', 'step approval');
  const head = el('div', 'step-head');
  head.appendChild(el('span', 'tag', 'approval'));
  head.appendChild(el('span', 'title', `需要审批：${esc(d.label)}`));
  head.appendChild(el('span', 'meta', `${d.expiresIn}s 超时自动放行`));
  const body = el('div', 'step-body');
  body.innerHTML = `${esc(d.policy)}\nscope: ${esc(d.scope)}\nparams: ${esc(JSON.stringify(d.params))}`;
  const actions = el('div', 'approval-actions');
  const allow = el('button', 'ok', '批准');
  const deny = el('button', 'deny', '拒绝');
  allow.onclick = () => { request('approve', { id: d.id, decision: 'allow' }); lockApproval(step, '已批准'); };
  deny.onclick = () => { request('approve', { id: d.id, decision: 'deny' }); lockApproval(step, '已拒绝'); };
  actions.appendChild(allow);
  actions.appendChild(deny);
  step.appendChild(head); step.appendChild(body); step.appendChild(actions);
  run.stepsEl.appendChild(step);
  run.approval = step;
  scrollDown();
}

function lockApproval(step, text) {
  step.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const meta = step.querySelector('.meta');
  if (meta) meta.textContent = text;
}

function onApprovalResolved(d) {
  const run = currentRun; if (run && run.approval && !run.approval.dataset.done) {
    run.approval.dataset.done = '1';
    lockApproval(run.approval, d.decision === 'deny' ? '已拒绝' : '已批准');
  }
}

function startMessage() {
  const run = currentRun; if (!run) return;
  const msg = el('div', 'msg assistant');
  msg.appendChild(el('div', 'avatar', 'AI'));
  const bubble = el('div', 'bubble');
  const stream = el('div', 'stream');
  const textNode = document.createTextNode('');
  const caret = el('span', 'caret');
  stream.appendChild(textNode);
  stream.appendChild(caret);
  bubble.appendChild(stream);
  msg.appendChild(bubble);
  run.el.appendChild(msg);
  run.msg = { stream, textNode, caret };
  scrollDown();
}

function deltaMessage(d) {
  const run = currentRun; if (!run || !run.msg) return;
  run.msg.textNode.data += d.delta;
  scrollDown();
}

function endMessage(d) {
  const run = currentRun; if (!run || !run.msg) return;
  run.msg.caret.remove();
  run.msg.stream.innerHTML = renderMarkdown(d.text);
  scrollDown();
}

function endRun(d) {
  if (d) {
    els.session.title = `intent=${d.intent} toolCalls=${d.toolCalls} tokens=${d.tokens.input}/${d.tokens.output} ${d.durationMs}ms`;
  }
  currentRun = null;
  setBusy(false);
}

function addErrorNotice(d) {
  if (els.welcome) { els.welcome.remove(); els.welcome = null; }
  const msg = el('div', 'msg assistant');
  msg.appendChild(el('div', 'avatar', 'AI'));
  const bubble = el('div', 'bubble');
  bubble.style.borderColor = 'var(--err)';
  bubble.textContent = '出错了：' + (d.message || d.reason || '未知错误');
  msg.appendChild(bubble);
  els.messages.appendChild(msg);
  scrollDown();
  setBusy(false);
}

/* ---------- trace panel ---------- */

const EV_CLASS = [
  [/^error|auth\.failed/, 'ev-err'],
  [/^agent_end|connection\.ready|tool_execution_result|^run\.check/, 'ev-ok'],
  [/^capability/, 'ev-cap'],
  [/^run\.plan|^run\.reasoning/, 'ev-think'],
  [/^phase\.start/, 'ev-lifecycle'],
  [/^memory/, 'ev-memory'],
  [/^run\.thinking/, 'ev-think'],
  [/^tool_execution_start|^approval/, 'ev-tool'],
  [/^message/, 'ev-msg'],
  [/^context/, 'ev-context'],
  [/^agent_start|^session/, 'ev-lifecycle']
];

function addTrace(event, data) {
  if (!connectedAt) connectedAt = Date.now();
  traceCount += 1;
  els.traceCount.textContent = traceCount;
  const cls = (EV_CLASS.find(([re]) => re.test(event)) || [null, 'ev-lifecycle'])[1];
  const line = el('div', 'trace-line');
  line.innerHTML =
    `<span class="t-ts">+${((Date.now() - connectedAt) / 1000).toFixed(2)}s</span>` +
    `<span class="t-ev ${cls}">${esc(event)}</span>` +
    `<span class="t-sum">${esc(traceSummary(event, data))}</span>`;
  els.trace.appendChild(line);
  els.trace.scrollTop = els.trace.scrollHeight;
}

function traceSummary(event, d) {
  if (!d) return '';
  switch (event) {
    case 'connection.ready': return `session=${d.sessionKey}`;
    case 'agent_start': return d.runId;
    case 'context.compiled': return `tools=${d.tools.length} stable=${d.stablePrefixChars}B tok=${d.usedTokens}`;
    case 'memory.recall': return `${d.hits.length} hits: ${d.hits.map((h) => h.score).join(',')}`;
    case 'run.thinking': return (d.delta || '').trim() || `intent=${d.intent}`;
    case 'tool_execution_start': return `${d.name} ${JSON.stringify(d.params)}`;
    case 'tool_execution_result': return `${d.name} → ${d.status} ${d.ms}ms`;
    case 'capability.load_start': return `${d.kind}:${d.name} loading (${d.source})`;
    case 'capability.loaded': return `${d.kind}:${d.name} loaded`;
    case 'capability.search_start': return `registry search: ${d.query}`;
    case 'capability.search_result': return `registry → ${(d.results || []).length} hits (${d.online ? 'online' : 'cache'})`;
    case 'phase.start': return `phase=${d.phase}`;
    case 'run.check': return `${(d.checks || []).filter((c) => c.ok).length}/${(d.checks || []).length} passed`;
    case 'run.reasoning': return `intent=${d.intent} · ${(d.lines || []).length} 条推理`;
    case 'run.plan': return `plan · ${(d.steps || []).length} 步`;
    case 'approval.request': return `${d.tool} waiting`;
    case 'approval.resolved': return `${d.tool} ${d.decision}`;
    case 'message_delta': return '';
    case 'message_end': return `${d.text.length} chars`;
    case 'agent_end': return `intent=${d.intent} tools=${d.toolCalls} ${d.durationMs}ms`;
    default: return JSON.stringify(d).slice(0, 90);
  }
}

/* ---------- markdown ---------- */

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

function renderMarkdown(md) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }

    if (/^\|.*\|/.test(line) && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      html += '<table><thead><tr>' + headers.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }

    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += `<blockquote>${inline(buf.join(' '))}</blockquote>`;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      html += '<ul>' + buf.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>';
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      html += '<ol>' + buf.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>';
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>\s?|[-*]\s+|\d+\.\s+|```|\|)/.test(lines[i])) { buf.push(lines[i]); i++; }
    html += `<p>${inline(buf.join('<br/>'))}</p>`;
  }
  return html;
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}

/* ---------- composer ---------- */

function setBusy(busy) {
  els.send.disabled = busy;
  els.send.textContent = busy ? '…' : '发送';
}

function submit(text) {
  const value = (text != null ? text : els.input.value).trim();
  if (!value || !authed) return;
  if (els.welcome) { els.welcome.remove(); els.welcome = null; }
  const msg = el('div', 'msg user');
  msg.appendChild(el('div', 'avatar', 'ME'));
  const bubble = el('div', 'bubble');
  bubble.textContent = value;
  msg.appendChild(bubble);
  els.messages.appendChild(msg);
  els.input.value = '';
  autoResize();
  scrollDown();
  setBusy(true);
  request('message', { text: value });
}

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

function resetUI() {
  els.messages.innerHTML = '';
  els.welcome = el('div', 'welcome');
  els.welcome.innerHTML = '<h2>会话已重置</h2><p>继续输入新的请求。</p>';
  els.messages.appendChild(els.welcome);
}

function initSuggestions() {
  SUGGESTIONS.forEach((s) => {
    const chip = el('button', 'chip', esc(s));
    chip.type = 'button';
    chip.onclick = () => { els.input.value = s; autoResize(); els.input.focus(); };
    els.suggestions.appendChild(chip);
  });
  const reset = el('button', 'chip', '↺ 重置会话');
  reset.type = 'button';
  reset.onclick = () => request('reset', {});
  els.suggestions.appendChild(reset);
}

els.composer.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
els.input.addEventListener('input', autoResize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});
document.getElementById('trace-clear').onclick = () => {
  els.trace.innerHTML = '';
  traceCount = 0;
  els.traceCount.textContent = '0';
  connectedAt = Date.now();
};

initSuggestions();
autoResize();
connect();
