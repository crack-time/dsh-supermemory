# dsh-supermemory

面向 DeepSeek Harness Web GUI（dsh web）的 **Supermemory 本地记忆反向代理插件** —— 把自托管的 supermemory 服务（localhost:6767）的 REST API 安全地暴露在 dsh 同源路由下，并附带与内置插件一致的原生设置卡片。

## 功能

### 设置卡片（dsh rc.7 设置页扩展）
- 在 GUI **设置 → 插件 → 插件配置** 页新增「Supermemory 代理」卡片，与内置 shell / agent-loop / web-search 卡片同款可折叠外观（设计令牌驱动，明暗主题自适应）
- **服务地址**：上游 supermemory 地址，留空默认 `http://localhost:6767`
- **API Key**：直接文本框粘贴保存（在 localhost:6767 首页可查看）
- **测试连接**：一键探测配置是否生效、上游是否可达
- 暂存式保存 / 放弃修改 + 「未保存」徽章；设置通过宿主 `ctx.settings` 持久化，改动即时生效、无需重启

### 反向代理（Host 端）
- `/plugins/@crack/dsh-supermemory/api/<path>` → `<baseUrl>/<path>`，方法 / 查询串 / 请求体原样透传
- **Host 端注入 `Authorization: Bearer <apiKey>`** —— 浏览器永远看不到 API Key，也没有 CORS 问题
- 未配置 API Key 时返回 401（带中文指引）；上游不可达返回 502

### 健康检查与配置接口
- `GET /health` —— 当前配置 + 对上游 `/v3/settings` 的可达性探测
- `GET /config`、`POST /config`（`{ patch }` 合并，schemastery 校验）—— 设置读写

### AI 记忆工具（原生 dsh 工具，无需 MCP）
插件 host 端直接把两个工具注册进 dsh 工具运行时（与 `run_code` / `web_search` 同一套机制），**只服务 dsh**：

- `supermemory_search` —— 语义检索记忆库（跨语言），把相关记忆带回对话
- `supermemory_save` —— 把实体化事实写入记忆库，实时生成向量、立即可搜

两个工具 host 端直连上游并注入配置的 API Key（与代理同一密钥源，无第二处凭据），模型不接触密钥。**不需要 MCP**：工具只在 dsh 内使用，MCP 桥只在需要跨客户端（Claude/Cursor 等）共享记忆时才值得引入。
### 托管本地服务器进程（可选）

管网卡里打开「随 dsh 自动启动/停止记忆服务」后，插件会在 **dsh web 启动加载时自动拉起** supermemory 服务端进程、**dsh web 停止时销毁**它（进程树，`taskkill /T /F` 兜底），省去手动跑 `start-supermemory.bat`：

- **服务器可执行文件路径**：`supermemory-server-windows-x64.exe` 的绝对路径（默认 C:/Users/crack/Supermemory/supermemory-server-windows-x64.exe，Windows 写真实路径即可）
- **OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL**：以环境变量注入子进程（默认 baseUrl https://token-plan-cn.xiaomimimo.com/v1、模型 mimo-v2.5），等价于 bat 里的 `set`
- 启动时先做**端口探测**：若 6767 已由外部实例在跑，则不重复拉起（状态显示「已在运行（外部实例）」，避免双写同一数据目录）；只杀**自己拉起的**进程，绝不碰外部实例
- 保存配置 / 手动「启动/重启托管」会用最新配置重启；崩溃不会自动无限重启（状态可见，手动按钮兜底）
- 关闭开关或清空路径即回到纯手动 bat 方式，完全兼容旧用法


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
  body: JSON.stringify({ q: '最近修复了什么问题', containerTag: 'sm_project_default' }),
})

// 写入记忆
fetch('/plugins/@crack/dsh-supermemory/api/v4/memories', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ memories: [{ content: '…' }], containerTag: 'sm_project_default' }),
})
```

完整接口见 supermemory 的 `GET /v4/openapi`。

## 开发

需要 Node + pnpm；**dsh 运行时与 devDependencies 均钉定 0.1.0-rc.7**（设置卡片为 rc.7 新能力）。

```powershell
pnpm install          # 安装构建链（typescript / tsdown）
pnpm run build        # 一次构建：tsc(host) + tsc(client) + tsdown
pnpm run typecheck    # 类型检查
```

- 构建后刷新浏览器页面即可加载新客户端 bundle（服务器按内容哈希提供 `lib/client.js`）
- 卡片样式为原生 PluginCard 同款值 + dsw 设计令牌（`--dsw-alias-*`），内联注入，不依赖任何其他插件

## 项目结构

```
dsh-supermemory/
├── src/index.ts                    # host 面：settings 命名空间 + 反向代理 / health / config 路由
├── src/client/index.ts             # 浏览器端入口（apply）：卡片注册 + 样式注入
├── src/client/card.tsx             # 设置弹窗卡片（原生 PluginCard 同款外观）
├── tsconfig.json / tsconfig.client.json  # host/client 双 program
├── tsdown.config.ts                # client bundle 协议构建
├── lib/client.js                   # 浏览器端 bundle（已构建，clone 即用）
├── lib/index.js                    # 宿主端入口
├── cordis.patch.yml                # 插件自带注册 patch（参考）
└── package.json                    # dsh.client 声明（devDeps 钉定 0.1.0-rc.7）
```

## 说明

- 不修改 DSH 自带代码；supermemory 本体（`localhost:6767`）独立运行，本插件只做同源桥接与配置管理
- API Key 仅存于 dsh 服务端用户设置中，浏览器与仓库均不接触密钥