/**
 * Client-side API endpoint constants for the Supermemory proxy.
 *
 * Mirrors the host API_PREFIX (src/http.ts). Kept in ONE place so a host route
 * change never requires touching card/index components. The client bundle
 * cannot import the host module (different build targets), so the prefix is
 * duplicated here by design — any drift is caught by the runtime 404.
 */
export declare const API_BASE = "/plugins/@crack/dsh-supermemory/api";
export declare const API_URLS: {
    readonly config: string;
    readonly health: string;
    readonly containers: string;
    readonly activeContainer: string;
    /** Per-session container: GET /api/session/:id/container */
    readonly sessionContainer: (sessionId: string) => string;
};
