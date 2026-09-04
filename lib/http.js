import { resolveConfig, upstreamBase, requireUpstream, setActiveContainer, activeContainer, } from './config.js';
import { getSessionContainer, setSessionContainer } from './hooks.js';
import { discoverContainers } from './containers.js';
import { probeHealth } from './upstream.js';
import { readBody, readJsonBody, sendJson } from './http-util.js';
import { maskApiKey } from './redact.js';
export const API_PREFIX = '/plugins/@crack/dsh-supermemory/api';
/** Extract the session id from the /session/<sid>/container path. */
function sessionIdFromPath(pathname) {
    return pathname.slice((API_PREFIX + '/session/').length, pathname.length - '/container'.length);
}
/** Config view safe for the browser: both secrets masked, plus has* flags. */
function clientConfig(scope) {
    const cfg = resolveConfig(scope);
    return {
        ...cfg,
        apiKey: maskApiKey(cfg.apiKey),
        hasKey: cfg.apiKey.length > 0,
        openaiApiKey: maskApiKey(cfg.openaiApiKey),
        hasOpenaiKey: cfg.openaiApiKey.length > 0,
    };
}
/** Health probe: report configuration + whether the upstream answers. */
async function health(scope) {
    const cfg = resolveConfig(scope);
    const base = upstreamBase(cfg);
    if (!cfg.apiKey) {
        return { ok: false, configured: false, baseUrl: base, error: 'api key not configured' };
    }
    const probe = await probeHealth(base, cfg.apiKey, 8000);
    return {
        ok: probe.ok,
        configured: true,
        baseUrl: base,
        reachable: probe.ok,
        ...(probe.status !== undefined ? { status: probe.status } : {}),
        ...(probe.error !== undefined ? { error: probe.error } : {}),
    };
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
/** Dispatch every /api route (mounted as a prefix on the dsh web server). */
export async function handleApi(ctx, scope, req, res, managed, reviewProxy) {
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    try {
        if (method === 'GET' && pathname === API_PREFIX + '/health') {
            const base = await health(scope);
            return sendJson(res, 200, { ...base, managed: managed.snapshot() });
        }
        if (method === 'GET' && pathname === API_PREFIX + '/config') {
            return sendJson(res, 200, clientConfig(scope));
        }
        if (method === 'GET' && pathname === API_PREFIX + '/containers') {
            const { base, apiKey } = requireUpstream(scope);
            try {
                const entries = await discoverContainers(base, apiKey);
                const containers = entries.map((c) => ({ tag: c.tag, staticCount: c.staticCount, dynamicCount: c.dynamicCount, docCount: c.docCount }));
                const active = activeContainer(scope);
                return sendJson(res, 200, { containers, active });
            }
            catch (e) {
                return sendJson(res, 502, { error: 'cannot reach supermemory' });
            }
        }
        if (method === 'POST' && pathname === API_PREFIX + '/config') {
            const body = await readJsonBody(req);
            const patch = body.patch;
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
                return sendJson(res, 400, { error: 'patch (object) required' });
            }
            await scope.update(patch);
            await managed.sync(scope, ctx); // reconcile the managed process after save
            if (reviewProxy)
                await reviewProxy.sync(scope, ctx); // reconcile the review-proxy too
            // Never echo the plaintext key back — clients get the masked view.
            return sendJson(res, 200, clientConfig(scope));
        }
        // Per-session container routes (GET lookup / PUT switch) share one path shape.
        const isSessionContainer = method === 'GET' || method === 'PUT'
            ? pathname.startsWith(API_PREFIX + '/session/') && pathname.endsWith('/container')
            : false;
        if (isSessionContainer && method === 'GET') {
            const sid = sessionIdFromPath(pathname);
            const tag = getSessionContainer(sid) ?? activeContainer(scope);
            return sendJson(res, 200, { containerTag: tag });
        }
        if (isSessionContainer && method === 'PUT') {
            const sid = sessionIdFromPath(pathname);
            const body = await readJsonBody(req);
            const tag = typeof body.containerTag === 'string' ? body.containerTag.trim() : '';
            if (!tag)
                return sendJson(res, 400, { error: 'containerTag (non-empty string) required' });
            setSessionContainer(sid, tag);
            return sendJson(res, 200, { containerTag: tag });
        }
        if (method === 'PUT' && pathname === API_PREFIX + '/active-container') {
            // Dedicated, validated switch path used by the settings card —
            // keeps container switching in one function.
            const body = await readJsonBody(req);
            const tag = typeof body.containerTag === 'string' ? body.containerTag.trim() : '';
            if (!tag)
                return sendJson(res, 400, { error: 'containerTag (non-empty string) required' });
            await setActiveContainer(scope, tag);
            return sendJson(res, 200, { activeContainer: tag });
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
