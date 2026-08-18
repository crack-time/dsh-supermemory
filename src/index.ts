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
 *   supermemory_search — semantic recall over the memory store;
 *   supermemory_save  — persist an entity-centric fact.
 * Both call the upstream directly with the configured Bearer key (the same
 * credential source as the proxy), so agents get memory without a browser
 * origin or any additional credential surface.
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
// Type-only imports: they only load the declaration merging into the cordis
// Context (`ctx.webServer` here); erased at compile time, zero runtime cost.
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { Context } from '@deepseek-ai/cordis';
// Loads dsh-tools' Context declaration merge (ctx.tools) and the ToolDefinition type.
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { IncomingMessage, ServerResponse } from 'node:http';

const API_PREFIX = '/plugins/@crack/dsh-supermemory/api';
const DEFAULT_BASE_URL = 'http://localhost:6767';

/** Resolved settings shape for the "supermemory" namespace. */
interface SupermemoryConfig {
    baseUrl: string;
    apiKey: string;
}

/** Settings namespace schema: where to reach the local Supermemory server. */
const SUPERMEMORY_SCHEMA = z.object({
    baseUrl: z.string().default(DEFAULT_BASE_URL),
    apiKey: z.string().default(''),
});

/** Required services: the web route registry, the user-settings seam, and the tool registry. */
const inject = ['webServer', 'settings', 'tools'];

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer | string) => {
            data += String(chunk);
            if (data.length > 10_000_000) {
                reject(Object.assign(new Error('request body too large'), { code: 413 }));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

/** Normalize the configured base URL: strip trailing slashes, keep http(s). */
function upstreamBase(cfg: Partial<SupermemoryConfig> | undefined): string {
    return (cfg?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function resolveConfig(scope: SettingsScope<any>): SupermemoryConfig {
    const value = scope.get();
    return {
        baseUrl: (value?.baseUrl as string | undefined) ?? DEFAULT_BASE_URL,
        apiKey: (value?.apiKey as string | undefined) ?? '',
    };
}

/** Health probe: report configuration + whether the upstream answers. */
async function health(scope: SettingsScope<any>): Promise<Record<string, unknown>> {
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
async function proxy(ctx: Context, scope: SettingsScope<any>, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const headers: Record<string, string> = { authorization: 'Bearer ' + cfg.apiKey };
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

async function handleApi(
    ctx: Context,
    scope: SettingsScope<any>,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    try {
        if (method === 'GET' && pathname === API_PREFIX + '/health') {
            return sendJson(res, 200, await health(scope));
        }
        if (method === 'GET' && pathname === API_PREFIX + '/config') {
            return sendJson(res, 200, resolveConfig(scope));
        }
        if (method === 'POST' && pathname === API_PREFIX + '/config') {
            const body = JSON.parse((await readBody(req)) || '{}') as { patch?: unknown };
            if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
                return sendJson(res, 400, { error: 'patch (object) required' });
            }
            await scope.update(body.patch);
            return sendJson(res, 200, resolveConfig(scope));
        }
        // Everything else: reverse proxy to the upstream Supermemory server.
        return await proxy(ctx, scope, req, res);
    }
    catch (error) {
        const code = (error as { code?: unknown }).code;
        const status = typeof code === 'number' ? code : 500;
        ctx.logger.warn('supermemory api:', error);
        sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
}


/** Default container tag for memory tools (mirrors the supermemory dashboard's "Default Project"). */
const DEFAULT_CONTAINER = 'sm_project_default';

/** Resolve + guard: the configured upstream and key, or a throw the registry turns into an error result. */
function requireUpstream(scope: SettingsScope<any>): { base: string; apiKey: string } {
    const cfg = resolveConfig(scope);
    if (!cfg.apiKey) {
        throw new Error('supermemory API key not configured — open dsh Settings → Supermemory 代理 and paste the API key from localhost:6767.');
    }
    return { base: upstreamBase(cfg), apiKey: cfg.apiKey };
}

/** Narrow one tool argument to a string with a fallback. */
function argString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * supersonic semantic search tool: model-facing recall over the local
 * Supermemory store. Host-side call with the configured Bearer key — the
 * model never sees credentials, and nothing crosses the browser origin.
 */
function makeSearchTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_search',
        description:
            'Search the local Supermemory memory store (语义检索、跨语言): recall previously saved facts, fixes, preferences and environment notes. Use it when the answer may already be in memory.',
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
                const results = (value as { results?: Array<{ memory?: string }> }).results ?? [];
                if (results.length === 0) return [{ type: 'text', text: '未找到相关记忆。' }];
                const lines = results.map((r, i) => `${i + 1}. ${r.memory ?? ''}`.trimEnd());
                return [{ type: 'text', text: `记忆检索结果（${lines.length} 条）：\n${lines.join('\n')}` }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { query?: unknown; containerTag?: unknown; limit?: unknown };
            const query = argString(a.query, '');
            if (!query) throw new Error('supermemory_search: query (non-empty string) is required');
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
            const data = (await res.json()) as {
                memories?: Array<{ memory?: string }>;
                results?: Array<{ memory?: string }>;
            };
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
function makeSaveTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_save',
        description:
            'Save a memory into the local Supermemory store (实体化、可语义检索). Use for durable facts: preferences, environment details, completed fixes.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description:
                        'Entity-centric memory text, e.g. "crack 的 supermemory 用 hf-mirror.com 下载模型" (max 10000 chars).',
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
                const created = (value as { created?: number }).created ?? 0;
                return [{ type: 'text', text: created > 0 ? `已保存 ${created} 条记忆。` : '保存失败。' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { content?: unknown; isStatic?: unknown; containerTag?: unknown };
            const content = argString(a.content, '');
            if (!content) throw new Error('supermemory_save: content (non-empty string) is required');
            if (content.length > 10000) throw new Error('supermemory_save: content exceeds 10000 chars');
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
            const data = (await res.json()) as { memories?: Array<{ id?: string }> };
            const created = Array.isArray(data.memories) ? data.memories.length : 1;
            return { ok: true, created };
        },
        timeoutMs: 20000,
    };
}

function apply(ctx: Context): void {
    // "supermemory" settings namespace: dsh rc.7 renders it as a settings card
    // (the client half registers the slot entry); `applies: 'live'` means card
    // edits reach the proxy immediately via settings/document-updated.
    const scope = ctx.settings.register(settingsNamespace('supermemory'), SUPERMEMORY_SCHEMA, {
        applies: 'live',
    });
    ctx.effect(() => {
        const disposers = [
            ctx.webServer.register({
                kind: 'prefix',
                path: API_PREFIX,
                handler: (req, res) => handleApi(ctx, scope, req, res),
            }),
            // AI-facing memory tools (host-side, direct to upstream with the
            // configured key — same credential source as the proxy routes).
            ctx.tools.register(makeSearchTool(scope)),
            ctx.tools.register(makeSaveTool(scope)),
        ];
        return () => disposers.forEach((dispose) => dispose());
    }, 'dsh-supermemory: proxy + health + config + memory tools');
}

export { apply, inject };
