# dsh-supermemory

面向 DeepSeek Harness Web GUI（dsh web）的 **Supermemory 本地记忆反向代理插件** —— 把自托管的 supermemory 服务（localhost:6767）的 REST API 安全地暴露在 dsh 同源路由下，并附带与内置插件一致的原生设置卡片。

## 功能

### 设置卡片（dsh rc.7 设置页扩展）
- 在 GUI **设置 → 插件 → 插件配置** 页新增「Supermemory 代理」卡片，与内置 shell / agent-loop / web-search 卡片同款可折叠外观（设计令牌驱动，明暗主题自适应）
- **服务地址**：上游 supermemory 地址，留空默认 `http://localhost:6767`
- **API Key**：直接文本框粘贴保存（在 localhost:6767 首页可查看）
- **当前记忆空间**：下拉选择器 —— 列出所有容器（含 static/dynamic 记忆计数），可**新建空间**；选择即保存为 `activeContainer`，新会话自动注入该空间的记忆上下文。下拉展开时按 60 秒缓存时效自动刷新
- **托管本地服务器**：exe 路径 + OPENAI_* 三项 + 托管状态（详见下文「托管本地服务器进程」）
- **测试连接**：一键探测配置是否生效、上游是否可达
- 暂存式保存 / 放弃修改 + 「未保存」徽章；设置通过宿主 `ctx.settings` 持久化，改动即时生效、无需重启

### 反向代理（Host 端）
- `/plugins/@crack/dsh-supermemory/api/<path>` → `<baseUrl>/<path>`，方法 / 查询串 / 请求体原样透传
- **Host 端注入 `Authorization: Bearer <apiKey>`** —— 浏览器永远看不到 API Key，也没有 CORS 问题
- 未配置 API Key 时返回 401（带中文指引）；上游不可达返回 502

### 健康检查与配置接口
- `GET /health` —— 当前配置 + 对上游 `/v3/settings` 的可达性探测
- `GET /config`、`POST /config`（`{ patch }` 合并，schemastery 校验）—— 设置读写
- `GET /containers` —— 列出全部容器（tag + static/dynamic 记忆数 + 文档数）
- `PUT /active-container` —— 专门、经校验的记忆空间切换端点（卡片下拉与工具共用）

### AI 记忆工具（原生 dsh 工具，无需 MCP）
插件 host 端把七个工具直接注册进 dsh 工具运行时（与 `run_code` / `web_search` 同一套机制），**只服务 dsh**：

- `supermemory_search` —— 语义检索记忆库（跨语言），把相关记忆带回对话
- `supermemory_save` —— 把实体化事实写入记忆库，实时生成向量、立即可搜
- `supermemory_forget` —— 删除记忆：精确 ids / 语义短语，`dryRun` 预览
- `supermemory_delete_document` —— 删除原始对话文档（级联删除其产生的记忆，需 `confirm:true`）
- `supermemory_select_memory` —— 模型驱动的空间切换路径（用户明确要求时；常规切换用设置卡片）
- `supermemory_list_containers` —— 列出所有空间及其 static/dynamic 记忆数
- `supermemory_list_documents` —— 列出某空间内的文档

七个工具 host 端直连上游并注入配置的 API Key（与代理同一密钥源，无第二处凭据），模型不接触密钥。**不需要 MCP**：工具只在 dsh 内使用，MCP 桥只在需要跨客户端（Claude/Cursor 等）共享记忆时才值得引入。

### 确定性记忆钩子（免工具 · 每会话注入 + 每轮写库）
host 端监听 dsh 会话事件，实现“零操作记忆”：

- **session/created → 注入记忆上下文**：会话创建时拉取 `activeContainer` 的 /v4/profile（长期事实 static + 近期动态 dynamic），连同容器清单作为第一条 user 消息注入（agent.inject），每会话一次；上游未就绪时最多重试 4 次（退避等待托管服务启动）；子代理会话跳过
- **turn/end → 逐轮写库**：每轮结束后把该轮文本（真实用户消息 + 助手回复 + 工具调用）POST 成 supermemory 文档（POST /v3/documents，customId=sessionId-turn-N、taskType=memory、dreaming=dynamic、documentDate=该轮时间），索引约 30–60 秒后成为可检索的动态记忆；子代理会话跳过
- **低值过滤**：纯确认/单一字符/命令式回复（“确认”“A”“do it”…）不写库
- **策略**：每轮都写，不做“关键才写”过滤（关键无法定义）；上下文注入顺序 系统提示词 → 记忆 → 用户消息 → 权限 → 技能

### 托管本地服务器进程（默认随 dsh 启停）

插件**默认**在 **dsh web 启动加载时自动拉起** supermemory 服务端进程、**dsh web 停止时销毁**它（进程树，`taskkill /T /F` 兜底），省去手动跑 `start-supermemory.bat`：

- **服务器可执行文件路径**：`supermemory-server-windows-x64.exe` 的绝对路径（默认 C:/Users/crack/Supermemory/supermemory-server-windows-x64.exe，Windows 写真实路径即可）
- **OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL**：以环境变量注入子进程（默认 baseUrl https://token-plan-cn.xiaomimimo.com/v1、模型 mimo-v2.5），等价于 bat 里的 `set`
- 启动时先做**端口探测**：若 6767 已由外部实例在跑，则不重复拉起（状态显示「已在运行（外部实例）」，避免双写同一数据目录）；只杀**自己拉起的**进程，绝不碰外部实例
- 保存配置会自动用最新配置重启；崩溃不会自动无限重启（状态可见，必要时重启 dsh web 重新拉起）
- 清空路径则不会自动启动（卡片会提示「请先填写服务器可执行文件路径并保存」）

## 源码结构

模块化拆分（单一职责，依赖方向单向）：

```
src/
├── index.ts           # 编排入口（apply + inject）
├── config.ts          # 设置 schema + 配置解析 + 统一切换路径
├── managed-server.ts  # 托管 supermemory 进程类
├── http.ts            # 反向代理 + 健康检查 + /api 路由
├── containers.ts      # 容器发现（并行 profile 请求）+ 计数
├── tools.ts           # 七个记忆工具
├── hooks.ts           # session/created 注入 + turn/end 写库（含低值过滤）
└── client/
    ├── index.ts       # client 入口（slot 注册 + 本地声明合并）
    ├── card.tsx       # 设置卡片组件
    ├── card-locale.ts # 卡片 i18n 字典
    └── card-css.ts    # 卡片样式（注入一次）
```

## 安装

插件通过符号链接安装到 dsh web profile（**lib/ 已随仓库提交，clone 即用，无需构建**）：

```powershell
# 1. 链接安装（一次性）
dsh plugin --profile web add "link:E:\path\to\dsh-supermemory"

# 2. 在 profile patch 中注册插件行
#    编辑 C:\Users\<you>\.dsh\profiles\web\cordis.patch.yml，追加：
#    - insert:
#        - id: supermemory-proxy
#          name: '@crack/dsh-supermemory'

# 3. 保存后 dsh 自动热重载（boot HMR 重读 patch），无需重启
```

## 使用

配置完成后（设置卡片里粘贴 API Key → 测试连接），浏览器端任意代码可直接调用：

```js
// 语义搜索（supermemory API v4，经 dsh 同源代理）
fetch('/plugins/@crack/dsh-supermemory/api/v4/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ q: '最近修复了什么问题', containerTag: 'code-dev' }),
})

// 写入记忆
fetch('/plugins/@crack/dsh-supermemory/api/v4/memories', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ memories: [{ content: '…' }], containerTag: 'code-dev' }),
})
```

完整接口见 supermemory 的 `GET /v4/openapi`。

## 开发

需要 Node + pnpm；**dsh 运行时与 devDependencies 均钉定 0.1.0-rc.7**（设置卡片为 rc.7 新能力）。

```powershell
pnpm install          # 安装构建链（typescript / tsdown + client 类型包）
pnpm run build        # 一次构建：tsc(host) + tsc(client) + tsdown
pnpm run typecheck    # 类型检查
```

- 构建后刷新浏览器页面即可加载新客户端 bundle（服务器按内容哈希提供 `lib/client.js`）
- host 端代码改动需重启 dsh web 生效
