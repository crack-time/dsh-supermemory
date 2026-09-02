/**
 * Shared upstream HTTP plumbing.
 *
 * Owns the low-level calls to the local Supermemory server that other modules
 * (containers, tools, http, hooks) used to repeat ad hoc: an authenticated JSON
 * request with uniform error surfacing, a paginated document-list walker, and
 * the /v3/settings health probe. The raw reverse-proxy passthrough in
 * http.proxy keeps its own fetch on purpose — this layer is for JSON APIs.
 */
export interface UpstreamHttpError extends Error {
    status?: number;
}
/** One document summary returned by /v3/documents/list (superset of fields the plugin reads). */
export interface DocumentSummary {
    id: string;
    title?: string;
    status?: string;
    createdAt?: string;
    containerTag?: string;
    containerTags?: string[];
    customId?: string;
    metadata?: {
        sessionId?: string;
    };
    [key: string]: unknown;
}
/** Doc → its container tags. The list endpoint may return a legacy singular `containerTag` field. */
export declare function containerTagsOf(doc: DocumentSummary): string[];
/** True when a document lives in the given (already trimmed) container tag. */
export declare function docInContainer(doc: DocumentSummary, tag: string): boolean;
interface RpcOptions {
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
}
/**
 * Authenticated JSON request to the upstream server. Sends `body` (objects are
 * JSON-serialized) with the bearer key, tolerates an empty 2xx response, and
 * throws an error carrying `status` (plus a short response excerpt) on non-2xx.
 */
export declare function apiFetch<T = unknown>(base: string, apiKey: string, path: string, opts?: RpcOptions): Promise<T>;
/**
 * Walk /v3/documents/list page by page. The endpoint returns every container's
 * documents, so callers inspect each page themselves. A hard `maxPages` cap
 * keeps runaway (or misbehaving) cases bounded. Upstream failures surface via
 * apiFetch.
 */
export declare function listDocumentPages(base: string, apiKey: string, opts: {
    limit?: number;
    startPage?: number;
    maxPages?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
}, onPage: (docs: DocumentSummary[]) => void): Promise<void>;
export interface HealthProbe {
    ok: boolean;
    status?: number;
    error?: string;
}
/** Reachability probe against the upstream /v3/settings endpoint. Never throws. */
export declare function probeHealth(base: string, apiKey: string, timeoutMs?: number): Promise<HealthProbe>;
export {};
