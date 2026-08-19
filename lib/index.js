/**
 * Host loader entry for the Supermemory proxy.
 *
 * Registers one settings namespace ("supermemory": baseUrl + apiKey) and one
 * prefix route on dsh's own web server:
 *
 *   /plugins/@crack/dsh-supermemory/api/health
 *     GET  — config + reachability probe against the upstream server.
 *   /plugins/@crack/dsh-supermemory/api/config
 *     GET  — current resolved settings (baseUrl, apiKey).
 *     POST — { patch } merge into the settings user document (validated).
 *   /plugins/@crack/dsh-supermemory/api/<any supermemory path>
 *     every other method+path is a generic reverse proxy to the configured
 *     upstream (method, query, body and content-type pass through untouched),
 *     with `Authorization: Bearer <apiKey>` injected Host-side — the browser
 *     never sees the key and there is no CORS to worry about.
 *
 * The upstream URL mirrors the path: .../api/v4/search → <baseUrl>/v4/search.
 *
 * AI-facing memory tools (host-side, registered into the dsh tool runtime):
 *   supermemory_search  — semantic recall over the memory store;
 *   supermemory_save    — persist an entity-centric fact;
 *   supermemory_forget  — forget memories by exact ids or semantic query.
 * Both call the upstream directly with the configured Bearer key (the same
 * credential source as the proxy), so agents get memory without a browser
 * origin or any additional credential surface.
 *
 * Deterministic memory hooks (host-side):
 *   session/created → fetch the stored profile and agent.inject() it as a
 *     synthetic recall message, so every session starts already knowing the
 *     user (one injection per session).
 *   session/event (turn/end) → compose that finished turn's transcript and
 *     POST it as a supermemory document (stable customId per session+turn),
 *     letting the upstream memory engine extract facts automatically.
 * Subagent sessions (delegationDepth > 0) are skipped for both hooks.
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
// Runtime helper that builds an identified user-role message for agent.inject().
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { statSync } from 'node:fs';
const API_PREFIX = '/plugins/@crack/dsh-supermemory/api';
const DEFAULT_BASE_URL = 'http://localhost:6767';
/** Settings namespace schema: where to reach the local Supermemory server. */
const SUPERMEMORY_SCHEMA = z.object({
    baseUrl: z.string().default(DEFAULT_BASE_URL),
    apiKey: z.string().default(''),
    // Managed local server: start/stop supermemory-server alongside dsh web.
    manageServer: z.boolean().default(false),
    serverPath: z.string().default(''),
    openaiApiKey: z.string().default(''),
    openaiBaseUrl: z.string().default('https://token-plan-cn.xiaomimimo.com/v1'),
    openaiModel: z.string().default('mimo-v2.5'),
});
/** Required services: the web route registry, the user-settings seam, the tool registry, and the agent factory (for context injection). */
const inject = ['webServer', 'settings', 'tools', 'agents'];
function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += String(chunk);
            if (data.length > 10000000) {
                reject(Object.assign(new Error('request body too large'), { code: 413 }));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
/** Normalize the configured base URL: strip trailing slashes, keep http(s). */
function upstreamBase(cfg) {
    return (cfg?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}
function resolveConfig(scope) {
    const value = scope.get();
    return {
        baseUrl: value?.baseUrl ?? DEFAULT_BASE_URL,
        apiKey: value?.apiKey ?? '',
        manageServer: value?.manageServer ?? false,
        serverPath: value?.serverPath ?? '',
        openaiApiKey: value?.openaiApiKey ?? '',
        openaiBaseUrl: value?.openaiBaseUrl ?? 'https://token-plan-cn.xiaomimimo.com/v1',
        openaiModel: value?.openaiModel ?? 'mimo-v2.5',
    };
}
class ManagedServer {
    child;
    info = { enabled: false, state: 'unmanaged' };
    lastSig = '';
    snapshot() {
        return { ...this.info };
    }
    signature(cfg) {
        return [
            cfg.serverPath,
            cfg.openaiBaseUrl,
            cfg.openaiModel,
            cfg.openaiApiKey,
        ].join('|');
    }
    /** Is the configured base URL already reachable (health probe against upstream /v3/settings). */
    async probe(cfg) {
        try {
            const res = await fetch(upstreamBase(cfg) + '/v3/settings', {
                headers: { authorization: 'Bearer ' + cfg.apiKey },
                signal: AbortSignal.timeout(2500),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Reconcile with current config: shutdown when unmanaged, (re)start when
     * config/path/model changed, keep running otherwise. Called on activation
     * and after every config save.
     */
    async sync(scope, ctx) {
        const cfg = resolveConfig(scope);
        if (!cfg.manageServer || !cfg.serverPath.trim()) {
            if (this.child && this.child.exitCode === null)
                await this.stop(ctx);
            this.info = { enabled: !!cfg.manageServer, state: 'unmanaged' };
            return;
        }
        const sig = this.signature(cfg);
        if (this.child && this.child.exitCode === null) {
            if (this.lastSig === sig)
                return; // healthy + unchanged
            await this.stop(ctx); // config changed -> restart with new env
            this.lastSig = sig;
            // We just killed our own process: skip the reachability probe (the
            // old listening socket may linger briefly and look "external").
            await this.start(scope, ctx, { skipProbe: true });
        }
        else {
            this.lastSig = sig;
            await this.start(scope, ctx);
        }
    }
    /**
     * Launch the managed process. Skips when already running or when an
     * external instance answers (unless `skipProbe`). Safe to call repeatedly.
     */
    async start(scope, ctx, opts = {}) {
        const cfg = resolveConfig(scope);
        if (!cfg.manageServer || !cfg.serverPath.trim()) {
            this.info = { enabled: !!cfg.manageServer, state: 'unmanaged' };
            return;
        }
        if (this.child && this.child.exitCode === null) {
            this.info = { enabled: true, state: 'running', pid: this.child.pid, source: 'spawned' };
            return;
        }
        const exePath = cfg.serverPath.trim();
        try {
            if (!statSync(exePath).isFile())
                throw new Error('not a file');
        }
        catch {
            this.info = { enabled: true, state: 'missing-exe', exe: exePath };
            ctx.logger.warn('[supermemory] managed server exe not found: ' + exePath);
            return;
        }
        if (!opts.skipProbe && (await this.probe(cfg))) {
            this.info = { enabled: true, state: 'external', exe: exePath, source: 'external' };
            return;
        }
        try {
            const child = spawn(exePath, [], {
                cwd: dirname(exePath),
                env: {
                    ...process.env,
                    OPENAI_API_KEY: cfg.openaiApiKey,
                    OPENAI_BASE_URL: cfg.openaiBaseUrl,
                    OPENAI_MODEL: cfg.openaiModel,
                },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            this.child = child;
            const onLog = (stream, tag) => {
                if (!stream)
                    return;
                stream.on('data', (buf) => {
                    const line = String(buf).trim();
                    if (!line)
                        return;
                    if (tag === 'stderr') {
                        this.info = { ...this.info, stderrTail: (this.info.stderrTail ?? '') + '\n' + line.slice(-400) };
                        if ((this.info.stderrTail?.length ?? 0) > 1200) {
                            this.info.stderrTail = this.info.stderrTail.slice(-1200);
                        }
                        ctx.logger.debug('[supermemory server] ' + line);
                    }
                    else {
                        ctx.logger.debug('[supermemory server] ' + line);
                    }
                });
            };
            onLog(child.stdout, 'stdout');
            onLog(child.stderr, 'stderr');
            child.on('exit', (code, signal) => {
                if (this.child !== child)
                    return;
                this.child = undefined;
                ctx.logger.info('[supermemory] managed server exited code=' + code + ' signal=' + String(signal));
                this.info = {
                    enabled: true,
                    state: 'stopped',
                    ...(this.info.pid ? { pid: this.info.pid } : {}),
                    exe: exePath,
                    error: code !== 0 ? 'server exited with code ' + code : undefined,
                };
            });
            child.on('error', (error) => {
                if (this.child !== child)
                    return;
                this.child = undefined;
                this.info = { enabled: true, state: 'error', exe: exePath, error: error.message };
                ctx.logger.warn('[supermemory] managed server spawn error: ' + error.message);
            });
            this.info = {
                enabled: true,
                state: child.pid ? 'running' : 'starting',
                pid: child.pid ?? undefined,
                source: 'spawned',
                exe: exePath,
            };
            ctx.logger.info('[supermemory] managed server spawned pid=' + child.pid + ' exe=' + exePath);
        }
        catch (error) {
            this.info = {
                enabled: true,
                state: 'error',
                exe: exePath,
                error: error instanceof Error ? error.message : String(error),
            };
            ctx.logger.warn('[supermemory] managed server spawn:', error);
        }
    }
    /** Manual "start / restart" from the card: restart our child, or spawn if none. */
    async ensureStarted(scope, ctx) {
        const cfg = resolveConfig(scope);
        if (!cfg.manageServer || !cfg.serverPath.trim()) {
            this.info = { enabled: !!cfg.manageServer, state: 'unmanaged' };
            return this.snapshot();
        }
        if (this.child && this.child.exitCode === null) {
            await this.stop(ctx);
            this.lastSig = this.signature(cfg);
            await this.start(scope, ctx, { skipProbe: true });
        }
        else {
            await this.start(scope, ctx);
        }
        return this.snapshot();
    }
    /** Kill only the process tree this plugin spawned. Never touches external instances. */
    async stop(ctx) {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid) {
            const pid = child.pid;
            try {
                child.kill();
            }
            catch { /* already dead */ }
            // Windows: guarantee the whole tree dies even if the exe spawned children.
            const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            killer.on('error', () => { });
            ctx.logger.info('[supermemory] managed server stopping pid=' + pid);
            this.info = {
                enabled: this.info.enabled,
                state: 'stopped',
                pid,
                exe: this.info.exe,
            };
        }
        else {
            this.info = { ...this.info, state: 'stopped' };
        }
        return this.snapshot();
    }
}
/** Health probe: report configuration + whether the upstream answers. */
async function health(scope) {
    const cfg = resolveConfig(scope);
    const base = upstreamBase(cfg);
    if (!cfg.apiKey) {
        return { ok: false, configured: false, baseUrl: base, error: 'api key not configured' };
    }
    try {
        const upstream = await fetch(base + '/v3/settings', {
            headers: { authorization: 'Bearer ' + cfg.apiKey },
            signal: AbortSignal.timeout(8000),
        });
        return {
            ok: upstream.ok,
            configured: true,
            baseUrl: base,
            reachable: upstream.ok,
            status: upstream.status,
        };
    }
    catch (error) {
        return {
            ok: false,
            configured: true,
            baseUrl: base,
            reachable: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Generic reverse proxy: /api/<path> → <baseUrl>/<path> with the same method,
 * query string and body; the upstream status and content-type pass through.
 */
async function proxy(ctx, scope, req, res) {
    const cfg = resolveConfig(scope);
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    const targetPath = url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length)
        : url.pathname;
    const base = upstreamBase(cfg);
    const target = base + (targetPath || '/') + url.search;
    if (!cfg.apiKey) {
        return sendJson(res, 401, {
            error: 'supermemory API key not configured — open dsh Settings → supermemory and set the API key.',
            code: 'API_KEY_MISSING',
        });
    }
    const headers = { authorization: 'Bearer ' + cfg.apiKey };
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'string' && contentType.length > 0)
        headers['content-type'] = contentType;
    const accept = req.headers['accept'];
    if (typeof accept === 'string' && accept.length > 0)
        headers['accept'] = accept;
    const bodyText = await readBody(req);
    const method = (req.method ?? 'GET').toUpperCase();
    try {
        const upstream = await fetch(target, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' || bodyText.length === 0
                ? undefined
                : bodyText,
        });
        const text = await upstream.text();
        const upstreamType = upstream.headers.get('content-type');
        res.writeHead(upstream.status, {
            'content-type': upstreamType ?? 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        });
        res.end(text);
    }
    catch (error) {
        ctx.logger.warn('supermemory proxy upstream:', error);
        sendJson(res, 502, {
            error: 'cannot reach supermemory at ' + base + ': ' +
                (error instanceof Error ? error.message : String(error)),
            code: 'UPSTREAM_UNREACHABLE',
        });
    }
}
async function handleApi(ctx, scope, req, res, managed) {
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    try {
        if (method === 'GET' && pathname === API_PREFIX + '/health') {
            const base = await health(scope);
            return sendJson(res, 200, { ...base, managed: managed.snapshot() });
        }
        if (method === 'GET' && pathname === API_PREFIX + '/config') {
            return sendJson(res, 200, resolveConfig(scope));
        }
        if (method === 'POST' && pathname === API_PREFIX + '/config') {
            const body = JSON.parse((await readBody(req)) || '{}');
            if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
                return sendJson(res, 400, { error: 'patch (object) required' });
            }
            await scope.update(body.patch);
            await managed.sync(scope, ctx); // reconcile the managed process after save
            return sendJson(res, 200, resolveConfig(scope));
        }
        if (method === 'POST' && pathname === API_PREFIX + '/server/start') {
            return sendJson(res, 200, { ok: true, managed: await managed.ensureStarted(scope, ctx) });
        }
        if (method === 'POST' && pathname === API_PREFIX + '/server/stop') {
            return sendJson(res, 200, { ok: true, managed: await managed.stop(ctx) });
        }
        // Everything else: reverse proxy to the upstream Supermemory server.
        return await proxy(ctx, scope, req, res);
    }
    catch (error) {
        const code = error.code;
        const status = typeof code === 'number' ? code : 500;
        ctx.logger.warn('supermemory api:', error);
        sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
}
/** Default container tag for memory tools (mirrors the supermemory dashboard's "Default Project"). */
const DEFAULT_CONTAINER = 'sm_project_default';
/** Resolve + guard: the configured upstream and key, or a throw the registry turns into an error result. */
function requireUpstream(scope) {
    const cfg = resolveConfig(scope);
    if (!cfg.apiKey) {
        throw new Error('supermemory API key not configured — open dsh Settings → Supermemory 代理 and paste the API key from localhost:6767.');
    }
    return { base: upstreamBase(cfg), apiKey: cfg.apiKey };
}
/** Narrow one tool argument to a string with a fallback. */
function argString(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}
/**
 * supersonic semantic search tool: model-facing recall over the local
 * Supermemory store. Host-side call with the configured Bearer key — the
 * model never sees credentials, and nothing crosses the browser origin.
 */
function makeSearchTool(scope) {
    return {
        name: 'supermemory_search',
        description: 'Search the local Supermemory memory store (语义检索、跨语言): recall previously saved facts, fixes, preferences and environment notes. Use it when the answer may already be in memory.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to look for, any language (e.g. "嵌入模型是怎么修好的").',
                },
                containerTag: {
                    type: 'string',
                    description: 'Scope the search to one container tag.',
                    default: DEFAULT_CONTAINER,
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (1–20).',
                    default: 5,
                },
            },
            required: ['query'],
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { memory: { type: 'string' } },
                            required: ['memory'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['results'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const results = value.results ?? [];
                if (results.length === 0)
                    return [{ type: 'text', text: '未找到相关记忆。' }];
                const lines = results.map((r, i) => `${i + 1}. ${r.memory ?? ''}`.trimEnd());
                return [{ type: 'text', text: `记忆检索结果（${lines.length} 条）：\n${lines.join('\n')}` }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const query = argString(a.query, '');
            if (!query)
                throw new Error('supermemory_search: query (non-empty string) is required');
            const tag = argString(a.containerTag, DEFAULT_CONTAINER);
            const raw = typeof a.limit === 'number' && Number.isFinite(a.limit) ? Math.floor(a.limit) : 5;
            const limit = Math.min(20, Math.max(1, raw));
            const { base, apiKey } = requireUpstream(scope);
            const res = await fetch(base + '/v4/search', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ q: query, containerTag: tag, threshold: 0.5, limit }),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error(`supermemory /v4/search failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
            }
            const data = (await res.json());
            const results = (data.memories ?? data.results ?? [])
                .map((m) => ({ memory: m.memory ?? '' }))
                .filter((m) => m.memory.length > 0);
            return { results };
        },
        timeoutMs: 30000,
    };
}
/**
 * Memory-write tool: persist an entity-centric fact into the local
 * Supermemory store (embeddings generated server-side, immediately
 * searchable). Call it when the user shares durable preferences, machine
 * environment facts, or completed fixes worth remembering.
 */
function makeSaveTool(scope) {
    return {
        name: 'supermemory_save',
        description: 'Save a memory into the local Supermemory store (实体化、可语义检索). Use for durable facts: preferences, environment details, completed fixes.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'Entity-centric memory text, e.g. "crack 的 supermemory 用 hf-mirror.com 下载模型" (max 10000 chars).',
                },
                isStatic: {
                    type: 'boolean',
                    description: 'True for permanent traits/facts; false for ephemeral notes.',
                    default: false,
                },
                containerTag: {
                    type: 'string',
                    description: 'Container tag to save under.',
                    default: DEFAULT_CONTAINER,
                },
            },
            required: ['content'],
        },
        output: {
            schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, created: { type: 'number' } },
                required: ['ok', 'created'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const created = value.created ?? 0;
                return [{ type: 'text', text: created > 0 ? `已保存 ${created} 条记忆。` : '保存失败。' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const content = argString(a.content, '');
            if (!content)
                throw new Error('supermemory_save: content (non-empty string) is required');
            if (content.length > 10000)
                throw new Error('supermemory_save: content exceeds 10000 chars');
            const isStatic = a.isStatic === true;
            const tag = argString(a.containerTag, DEFAULT_CONTAINER);
            const { base, apiKey } = requireUpstream(scope);
            const res = await fetch(base + '/v4/memories', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ memories: [{ content, isStatic }], containerTag: tag }),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error(`supermemory /v4/memories failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
            }
            const data = (await res.json());
            const created = Array.isArray(data.memories) ? data.memories.length : 1;
            return { ok: true, created };
        },
        timeoutMs: 20000,
    };
}
/**
 * Memory-forget tool: delete memories from the local Supermemory store —
 * either exact memory ids, or a natural-language query the server matches
 * semantically. dryRun previews before any mutation.
 */
function makeForgetTool(scope) {
    return {
        name: 'supermemory_forget',
        description: 'Delete or forget memories in the local Supermemory store (删除/遗忘记忆). Pass exact memory ids, or a natural-language query/topic the server matches semantically; use dryRun to preview first. Use it to clean up wrong, outdated or test memories.',
        parameters: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exact memory ids to forget (no semantic matching). Either ids or query is required.',
                },
                query: {
                    type: 'string',
                    description: 'Natural-language instruction ("forget everything about Project Titan") or a bare topic ("Project Titan"). Either ids or query is required.',
                },
                containerTag: {
                    type: 'string',
                    description: 'Container tag / space the forget operation is scoped to.',
                    default: DEFAULT_CONTAINER,
                },
                dryRun: {
                    type: 'boolean',
                    description: 'When true, only preview which memories WOULD be forgotten (no mutation).',
                    default: false,
                },
                threshold: {
                    type: 'number',
                    description: 'Minimum cosine similarity for semantic matching (lower = wider net).',
                    default: 0.5,
                },
                maxForget: {
                    type: 'number',
                    description: 'Maximum number of memories this call may forget (1–500).',
                    default: 100,
                },
                reason: {
                    type: 'string',
                    description: 'Optional reason stored as forgetReason on each memory.',
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    dryRun: { type: 'boolean' },
                    count: { type: 'number' },
                    forgetBatchId: { type: 'string' },
                    summary: { type: 'string' },
                },
                required: ['dryRun', 'count', 'summary'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                const prefix = v.dryRun ? '（预览，未实际删除）' : '';
                return [{ type: 'text', text: 'supermemory_forget' + prefix + ': ' + (v.summary ?? '') + '（' + (v.count ?? 0) + ' 条）' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const ids = Array.isArray(a.ids)
                ? a.ids
                    .filter((x) => typeof x === 'string' && x.trim().length > 0)
                    .map((x) => x.trim())
                : [];
            const query = argString(a.query, '');
            if (ids.length === 0 && !query) {
                throw new Error('supermemory_forget: provide either ids (non-empty array) or query (non-empty string)');
            }
            if (ids.length > 500)
                throw new Error('supermemory_forget: at most 500 ids');
            const tag = argString(a.containerTag, DEFAULT_CONTAINER);
            const dryRun = a.dryRun === true;
            const rawThreshold = typeof a.threshold === 'number' && Number.isFinite(a.threshold) ? a.threshold : 0.5;
            const threshold = Math.min(1, Math.max(0, rawThreshold));
            const rawMax = typeof a.maxForget === 'number' && Number.isFinite(a.maxForget) ? Math.floor(a.maxForget) : 100;
            const maxForget = Math.min(500, Math.max(1, rawMax));
            const reason = argString(a.reason, '');
            const { base, apiKey } = requireUpstream(scope);
            const body = { containerTag: tag, dryRun, threshold, maxForget };
            if (ids.length > 0)
                body.ids = ids;
            if (query)
                body.query = query;
            if (reason)
                body.reason = reason;
            const res = await fetch(base + '/v4/memories/forget-matching', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error('supermemory /v4/memories/forget-matching failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
            }
            const data = (await res.json());
            return {
                dryRun: data.dryRun === true,
                count: typeof data.count === 'number' ? data.count : 0,
                forgetBatchId: data.forgetBatchId ?? '',
                summary: data.summary ?? '',
            };
        },
        timeoutMs: 30000,
    };
}
/**
 * Extract the plain-text segments from a message's content blocks.
 */
function messageText(content) {
    return content
        .map((block) => {
        const b = block;
        if (typeof b.text === 'string' && b.text.length > 0)
            return b.text;
        if (typeof b.content === 'string' && b.content.length > 0)
            return b.content;
        return '';
    })
        .filter((text) => text.length > 0)
        .join('\n');
}
/**
 * Compose the transcript of one finished turn into a self-contained document:
 * the real user message(s) plus the assistant replies and tool calls that were
 * produced after this turn's turn/start. Injected/synthetic user messages
 * (source.kind !== 'user') are excluded so we never persist harness noise.
 */
function turnTranscript(session, turn, maxChars = 6000) {
    const events = session.events;
    const start = events.findIndex((e) => e.type === 'turn/start' && e.data.turn === turn);
    if (start < 0)
        return '';
    const parts = [];
    for (let index = start; index < events.length; index += 1) {
        const e = events[index];
        if (!e)
            continue;
        if (e.type === 'turn/end')
            break;
        if (e.type === 'user/message') {
            const source = e.data.source;
            if (source?.kind !== 'user')
                continue;
            const text = messageText(e.data.content);
            if (text.length > 0)
                parts.push('User:\n' + text);
        }
        else if (e.type === 'assistant/message') {
            const text = messageText(e.data.message.content);
            if (text.length > 0)
                parts.push('Assistant:\n' + text);
        }
        else if (e.type === 'tool/call') {
            const d = e.data;
            parts.push('[tool] ' + d.name + '(' + d.arguments + ')');
        }
    }
    const text = parts.join('\n\n').trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}
/** Fetch the stored profile (static + dynamic facts) for the default container. */
async function fetchProfile(scope) {
    const { base, apiKey } = requireUpstream(scope);
    const res = await fetch(base + '/v4/profile', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ containerTag: DEFAULT_CONTAINER }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
        return '';
    const data = (await res.json());
    const lines = [];
    const stat = data.profile?.static ?? [];
    const dyn = data.profile?.dynamic ?? [];
    if (stat.length > 0)
        lines.push('长期事实 (static):\n- ' + stat.join('\n- '));
    if (dyn.length > 0)
        lines.push('近期动态 (dynamic):\n- ' + dyn.join('\n- '));
    return lines.join('\n\n');
}
/** Inject recall context into the session's agent as a synthetic user message. */
function injectContext(ctx, session, text) {
    const agent = ctx.agents.get(session.id);
    if (!agent)
        return;
    try {
        agent.inject(createUserMessage({
            content: [{ type: 'text', text: '\u3010记忆上下文（来自本地 supermemory）\u3011\n' + text }],
            source: { kind: 'plugin', plugin: '@crack/dsh-supermemory', form: 'recall' },
        }));
    }
    catch (error) {
        ctx.logger.warn('supermemory context inject:', error);
    }
}
/** Persist one finished turn as a supermemory document (fire-and-forget). */
async function persistTurn(ctx, scope, session, turn, text) {
    try {
        const { base, apiKey } = requireUpstream(scope);
        const customId = (session.id + '-turn-' + turn)
            .replace(/[^A-Za-z0-9_.-]/g, '-')
            .slice(0, 100);
        const res = await fetch(base + '/v3/documents', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
                content: text,
                containerTag: DEFAULT_CONTAINER,
                customId,
                taskType: 'memory',
                dreaming: 'dynamic',
                metadata: { sessionId: session.id, turn },
            }),
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
            ctx.logger.warn('supermemory turn persist: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        }
    }
    catch (error) {
        ctx.logger.warn('supermemory turn persist:', error);
    }
}
/** Skip subagent sessions for both hooks. */
function isSubagent(session) {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
/** Sessions that already received a profile injection (one per session). */
const injectedSessions = new Set();
function apply(ctx) {
    // "supermemory" settings namespace: dsh rc.7 renders it as a settings card
    // (the client half registers the slot entry); `applies: 'live'` means card
    // edits reach the proxy immediately via settings/document-updated.
    const scope = ctx.settings.register(settingsNamespace('supermemory'), SUPERMEMORY_SCHEMA, {
        applies: 'live',
    });
    // Managed local server: spawn alongside dsh web, kill on dispose.
    const managed = new ManagedServer();
    ctx.effect(() => {
        // Start (or adopt) the managed server when this plugin activates —
        // i.e. when dsh web boots and loads the plugin.
        void managed.sync(scope, ctx);
        const disposers = [
            ctx.webServer.register({
                kind: 'prefix',
                path: API_PREFIX,
                handler: (req, res) => handleApi(ctx, scope, req, res, managed),
            }),
            // AI-facing memory tools (host-side, direct to upstream with the
            // configured key — same credential source as the proxy routes).
            ctx.tools.register(makeSearchTool(scope)),
            ctx.tools.register(makeSaveTool(scope)),
            ctx.tools.register(makeForgetTool(scope)),
            // Deterministic read: inject the stored profile at session start.
            ctx.on('session/created', (session) => {
                if (isSubagent(session))
                    return;
                if (injectedSessions.has(session.id))
                    return;
                injectedSessions.add(session.id);
                fetchProfile(scope)
                    .then((text) => {
                    if (text)
                        injectContext(ctx, session, text);
                })
                    .catch((error) => ctx.logger.warn('supermemory profile inject:', error));
            }),
            // Deterministic write: persist each finished turn.
            ctx.on('session/event', (session, event) => {
                if (event.type !== 'turn/end')
                    return;
                if (isSubagent(session))
                    return;
                const turn = event.data.turn;
                const transcript = turnTranscript(session, turn);
                if (!transcript)
                    return;
                void persistTurn(ctx, scope, session, turn, transcript);
            }),
        ];
        return () => {
            // dsh web is stopping: tear down the managed server process tree.
            void managed.stop(ctx);
            disposers.forEach((dispose) => dispose());
        };
    }, 'dsh-supermemory: proxy + health + config + memory tools');
}
export { apply, inject };
