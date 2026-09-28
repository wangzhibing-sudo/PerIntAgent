# 个人智能助理 Agent · Web 演示

一个**本地优先**的个人智能助理 Agent，包含 Gateway + Agent Runtime 后端与一个可交互的 Web 演示页面。它不只是聊天：会调用工具、召回记忆、联网检索并**按需自动加载 Skill / MCP**，危险操作先向人类审批，并把整条**思维链（思考 → 推理 → 执行 → 检查）**实时可视化。

## 功能特性

- **四阶段思维链可视化**：每次运行按 `思考 → 推理 → 执行 → 检查` 分阶段展示，推理逻辑（意图识别、能力扫描、检索决策、执行计划、结果校验）逐条可见。
- **能力自动发现与加载**：当现有工具无法满足问题时，自动到 MCP 注册表检索现成可用的 MCP / Skill，命中后**自动安装、连接并直接调用**。例如问「现在麦当劳有什么优惠券？」，会检索到 `mcdonalds` MCP 并调用 `list_coupons`。
- **ReAct 工具调用**：基于 DeepSeek 的流式输出 + Function Calling，多轮「模型推理 → 工具执行 → 再推理」。
- **分层记忆**：精选核心记忆 + 情景记忆，bigram + 标签 + 时近性 + 重要度打分召回，跨会话生效。
- **HITL 审批**：`exec` 等危险工具触发审批请求，Web 上点击放行/拒绝，15s 超时自动放行。
- **可观测性**：右侧 Runtime 事件流实时打印每一个协议事件（含序号与时间戳）。
- **离线可跑**：未配置 API Key 时自动回退到本地确定性引擎（mock），演示全流程不依赖外网。

## 技术栈

- Node.js（>= 20，本项目在 Node 24 验证）
- Express（静态站点 + `/api/config`）
- ws（WebSocket Gateway）
- DeepSeek Chat Completions API（OpenAI 兼容，SSE 流式）
- 原生 HTML / CSS / JavaScript 前端（无构建步骤）

## 目录结构

```
.
├── server.js            # Gateway + Agent Runtime（核心）
├── public/
│   ├── index.html       # 演示页面
│   ├── style.css        # 样式（深色主题）
│   └── app.js           # WebSocket 客户端 + 事件渲染
├── data/state.json      # 运行时状态（记忆/会话/统计/已激活能力，自动生成）
├── .env                 # 本地配置（含 API Key，已被 .gitignore 忽略）
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env`（可参考下方字段；不配置也能以 mock 模式运行）：

```dotenv
# 必填：DeepSeek API Key（不配置则使用本地确定性引擎 mock）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 可选：Gateway 监听地址与鉴权 token
HOST=127.0.0.1
PORT=8787
AGENT_TOKEN=demo-token

# 可选：MCP 注册表地址（用于能力自动发现）
MCP_REGISTRY_URL=https://registry.modelcontextprotocol.io/v0/servers
```

### 3. 启动

```bash
npm start
# 等价于：node --env-file-if-exists=.env server.js
```

启动后终端会打印：

```
  个人智能助理 Agent · Web 演示
  Gateway:   http://127.0.0.1:8787
  Provider:  deepseek-chat @ api.deepseek.com
  ...
```

### 4. 打开演示页面

浏览器访问 <http://127.0.0.1:8787>，页面会自动用内置 token 连接 WebSocket。

## 使用方法

1. 在底部输入框输入请求，`Enter` 发送，`Shift+Enter` 换行。
2. 每次请求上方会出现 **四个阶段徽章**：思考 / 推理 / 执行 / 检查，当前阶段高亮；下方按阶段展示详细步骤卡片：
   - **思考**：能力扫描、联网检索能力库、加载 Skill / MCP。
   - **推理**：意图识别、检索与决策、执行计划（Plan）。
   - **执行**：实际工具调用与返回。
   - **检查**：结果一致性、权限约束、引用可追溯校验。
3. 顶部能力栏实时显示已激活的 **Skills / MCP**，新加载的能力会高亮；右上角胶囊显示 Model / Session / Tools / Skills / MCP 数量。
4. 危险操作（如 `exec`）会在对话流内弹出审批按钮，点击「允许 / 拒绝」。
5. 点击示例芯片快速填入问题，或点「↺ 重置会话」清空上下文。
6. 右侧「Runtime 事件流」可查看完整协议事件，便于调试。

### 试试这些例子

- `现在麦当劳有什么优惠券？` —— 触发能力发现：检索并自动加载 `mcdonalds` MCP 后查询。
- `帮我查一下上海今天的天气` —— 检索并加载 `weather` MCP。
- `记住我偏好简洁的中文回复` —— 写入长期记忆。
- `帮我做一份竞品调研` —— 动态加载 `research` Skill。
- `运行 git status` —— 触发 `exec`，演示 HITL 审批。

## 工作原理

### 事件协议（WebSocket）

首次连接需发送 `connect` 帧：

```json
{ "type": "connect", "token": "demo-token", "sessionKey": "agent:main:web:demo" }
```

之后：

- 客户端请求：`{ "type": "req", "id": "1", "method": "message", "params": { "text": "..." } }`
  - 方法：`message`（发起运行）、`approve`（审批）、`reset`（重置会话）、`load`（手动加载能力）
- 服务端响应：`{ "type": "res", "id": "1", "ok": true, "result": {...} }`
- 服务端推送：`{ "type": "event", "seq": 12, "ts": 1700000000000, "event": "message_delta", "data": {...} }`

主要事件：

| 事件 | 说明 |
| --- | --- |
| `connection.open` / `connection.ready` | 连接建立 / 鉴权通过（返回工具、能力列表） |
| `agent_start` / `agent_end` | 运行开始 / 结束（含耗时、token、统计） |
| `phase.start` | 阶段切换：`think` / `reason` / `execute` / `check` |
| `run.reasoning` / `run.plan` | 推理逻辑条目 / 执行计划 |
| `context.compiled` / `memory.recall` | 上下文组装 / 记忆召回 |
| `capability.search_start` / `capability.search_result` | 联网检索能力库 / 检索结果 |
| `capability.load_start` / `capability.loaded` | 动态加载 Skill / MCP |
| `tool_execution_start` / `tool_execution_result` | 工具调用 / 返回 |
| `approval.request` / `approval.resolved` | 审批发起 / 结果 |
| `message_start` / `message_delta` / `message_end` | 助手回复流式输出 |
| `run.check` | 检查阶段的校验项 |

### 内置能力

- **工具（BASE_TOOLS）**：`read`、`write`、`glob`、`grep`、`web_search`、`calendar`、`send_message`、`memory_write`、`sessions_spawn`、`exec`（需审批）。
- **元工具（META_TOOLS）**：`load_skill`、`load_mcp`（模型可主动加载能力）。
- **内置 Skills**：`coding`、`research`、`office`、`ecommerce`、`data-analysis`、`travel`。
- **内置 MCP**：`filesystem`、`fetch`、`calendar`、`github`、`sqlite`、`browser`。
- **远程可发现（注册表缓存）**：`weather`、`maps`、`news`、`mcdonalds`、`starbucks`、`translation` 等。

MCP 工具以 `server__tool` 命名（如 `mcdonalds__list_coupons`、`filesystem__read_file`）。

### 能力发现流程

1. 用户提问 → 识别意图。
2. 扫描本地目录中已激活 / 可加载的 Skill、MCP。
3. 若无匹配 → 到 `MCP_REGISTRY_URL` 检索（请求超时或不可达时回退到内置缓存索引）。
4. 命中后自动安装、连接，并将工具注入模型可选工具集。
5. 模型直接调用新工具完成任务。

> 说明：`registry.modelcontextprotocol.io` 在部分网络环境不可达，此时检索结果会标注为「本地缓存索引」；如需真实线上检索，请将 `MCP_REGISTRY_URL` 指向可访问的注册表。

## 常见问题

- **端口被占用**：修改 `.env` 中的 `PORT`，或结束占用 `8787` 的进程。
- **提示回退本地引擎**：说明未配置 `DEEPSEEK_API_KEY` 或调用失败，属正常降级，功能流程仍可演示。
- **重置状态**：删除 `data/state.json` 后重启，会重新生成初始记忆与基础能力。

## 安全说明

- `.env`、`data/`、`*.log` 已在 `.gitignore` 中忽略，**请勿提交 API Key**。
- 危险工具默认走人工审批；演示环境请仅在本机使用。

## License

MIT
