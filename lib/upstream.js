/**
 * Shared upstream HTTP plumbing.
 *
 * Owns the low-level calls to the local Supermemory server that other modules
 * (containers, tools, http, hooks) used to repeat ad hoc: an authenticated JSON
 * request with uniform error surfacing, a paginated document-list walker, and
 * the /v3/settings health probe. The raw reverse-proxy passthrough in
 * http.proxy keeps its own fetch on purpose — this layer is for JSON APIs.
 */
/** Doc → its container tags. The list endpoint may return a legacy singular `containerTag` field. */
export function containerTagsOf(doc) {
    if (Array.isArray(doc.containerTags)) {
        return doc.containerTags
            .filter((t) => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim());
    }
    if (typeof doc.containerTag === 'string' && doc.containerTag.trim()) {
        return [doc.containerTag.trim()];
    }
    return [];
}
/** True when a document lives in the given (already trimmed) container tag. */
export function docInContainer(doc, tag) {
    return containerTagsOf(doc).includes(tag);
}
/**
 * Authenticated JSON request to the upstream server. Sends `body` (objects are
 * JSON-serialized) with the bearer key, tolerates an empty 2xx response, and
 * throws an error carrying `status` (plus a short response excerpt) on non-2xx.
 */
export async function apiFetch(base, apiKey, path, opts = {}) {
    const { method = 'GET', body, signal, timeoutMs } = opts;
    const headers = { authorization: 'Bearer ' + apiKey };
    let payload;
    if (body !== undefined) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        headers['content-type'] = 'application/json';
    }
    const res = await fetch(base + path, {
        method,
        headers,
        body: payload,
        signal: signal ?? (timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined),
    });
    if (!res.ok) {
        const excerpt = (await res.text()).slice(0, 200);
        const err = new Error(method + ' ' + path + ' failed: HTTP ' + res.status + (excerpt ? ' — ' + excerpt : ''));
        err.status = res.status;
        throw err;
    }
    const text = await res.text();
    if (!text)
        return undefined;
    return JSON.parse(text);
}
/**
 * Walk /v3/documents/list page by page. The endpoint returns every container's
 * documents, so callers inspect each page themselves. A hard `maxPages` cap
 * keeps runaway (or misbehaving) cases bounded. Upstream failures surface via
 * apiFetch.
 */
export async function listDocumentPages(base, apiKey, opts, onPage) {
    const limit = opts.limit ?? 200;
    const maxPages = opts.maxPages ?? 20;
    let page = opts.startPage ?? 1;
    let totalPages = 1;
    do {
        const data = await apiFetch(base, apiKey, '/v3/documents/list', { method: 'POST', body: { limit, page }, signal: opts.signal, timeoutMs: opts.timeoutMs });
        onPage(data.memories ?? []);
        totalPages = data.pagination?.totalPages ?? 1;
        page = (data.pagination?.currentPage ?? page) + 1;
    } while (page <= totalPages && page <= maxPages);
}
/** Reachability probe against the upstream /v3/settings endpoint. Never throws. */
export async function probeHealth(base, apiKey, timeoutMs = 5000) {
    try {
        const res = await fetch(base + '/v3/settings', {
            headers: { authorization: 'Bearer ' + apiKey },
            signal: AbortSignal.timeout(timeoutMs),
        });
        return { ok: res.ok, status: res.status };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
