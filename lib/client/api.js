/**
 * Client-side API endpoint constants for the Supermemory proxy.
 *
 * Mirrors the host API_PREFIX (src/http.ts). Kept in ONE place so a host route
 * change never requires touching card/index components. The client bundle
 * cannot import the host module (different build targets), so the prefix is
 * duplicated here by design — any drift is caught by the runtime 404.
 */
export const API_BASE = '/plugins/@crack/dsh-supermemory/api';
export const API_URLS = {
    config: API_BASE + '/config',
    health: API_BASE + '/health',
    containers: API_BASE + '/containers',
    activeContainer: API_BASE + '/active-container',
    /** Per-session container: GET/PUT /api/session/:id/container */
    sessionContainer: (sessionId) => API_BASE + '/session/' + encodeURIComponent(sessionId) + '/container',
};
