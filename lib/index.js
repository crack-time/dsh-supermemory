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
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
const API_PREFIX = '/plugins/@crack/dsh-supermemory/api';
const DEFAULT_BASE_URL = 'http://localhost:6767';
/** Settings namespace schema: where to reach the local Supermemory server. */
const SUPERMEMORY_SCHEMA = z.object({
    baseUrl: z.string().default(DEFAULT_BASE_URL),
    apiKey: z.string().default(''),
});
/** Required services: the web route registry and the user-settings seam. */
const inject = ['webServer', 'settings'];
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
    };
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
async function handleApi(ctx, scope, req, res) {
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
            const body = JSON.parse((await readBody(req)) || '{}');
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
        const code = error.code;
        const status = typeof code === 'number' ? code : 500;
        ctx.logger.warn('supermemory api:', error);
        sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
}
function apply(ctx) {
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
        ];
        return () => disposers.forEach((dispose) => dispose());
    }, 'dsh-supermemory: proxy + health + config');
}
export { apply, inject };
