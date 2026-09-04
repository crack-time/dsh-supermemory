/**
 * Settings schema + config resolution for the "supermemory" namespace.
 *
 * Owns: the schemastery schema, the resolved-config shape, the upstream
 * helpers (base URL / api key guards) and the active-container resolution.
 * Everything else in the plugin imports from here; this module never
 * imports back.
 */
import z from '@deepseek-ai/schemastery';
export const DEFAULT_BASE_URL = 'http://localhost:6767';
export const DEFAULT_CONTAINER = 'sm_project_default';
// The managed supermemory server needs an OpenAI-compatible endpoint to embed
// with. Leave the defaults empty — a user running the managed server sets their
// own values in the settings card (a plugin default must not bake in one
// person's proprietary proxy/endpoint).
export const DEFAULT_OPENAI_BASE_URL = '';
export const DEFAULT_OPENAI_MODEL = '';
/** Settings namespace schema: where to reach the local Supermemory server. */
export const SUPERMEMORY_SCHEMA = z.object({
    baseUrl: z.string().default(DEFAULT_BASE_URL),
    apiKey: z.string().default(''),
    // Managed local server: start/stop supermemory-server alongside dsh web.
    serverPath: z.string().default(''),
    openaiApiKey: z.string().default(''),
    openaiBaseUrl: z.string().default(DEFAULT_OPENAI_BASE_URL),
    openaiModel: z.string().default(DEFAULT_OPENAI_MODEL),
    activeContainer: z.string().default(''),
    // Managed review-proxy: path to proxy.mjs + its port.
    reviewProxyPath: z.string().default(''),
    reviewProxyPort: z.number().default(6768),
    // Per-message dynamic recall tuning.
    recallEnabled: z.boolean().default(true),
    recallTopK: z.number().default(4),
    recallMaxChars: z.number().default(1600),
    recallThreshold: z.number().default(0.55),
});
function mergeConfig(value) {
    const v = (value ?? {});
    return {
        baseUrl: v.baseUrl ?? DEFAULT_BASE_URL,
        apiKey: v.apiKey ?? '',
        serverPath: v.serverPath ?? '',
        openaiApiKey: v.openaiApiKey ?? '',
        openaiBaseUrl: v.openaiBaseUrl ?? DEFAULT_OPENAI_BASE_URL,
        openaiModel: v.openaiModel ?? DEFAULT_OPENAI_MODEL,
        reviewProxyPath: v.reviewProxyPath ?? '',
        reviewProxyPort: typeof v.reviewProxyPort === 'number' && Number.isFinite(v.reviewProxyPort) ? Math.floor(v.reviewProxyPort) : 6768,
        activeContainer: v.activeContainer ?? '',
        recallEnabled: v.recallEnabled === undefined ? true : v.recallEnabled === true,
        recallTopK: typeof v.recallTopK === 'number' && Number.isFinite(v.recallTopK) ? Math.max(1, Math.min(10, Math.floor(v.recallTopK))) : 4,
        recallMaxChars: typeof v.recallMaxChars === 'number' && Number.isFinite(v.recallMaxChars) ? Math.max(200, Math.floor(v.recallMaxChars)) : 1600,
        recallThreshold: typeof v.recallThreshold === 'number' && Number.isFinite(v.recallThreshold) ? Math.max(0, Math.min(1, v.recallThreshold)) : 0.55,
    };
}
/** Resolve the effective configuration from a settings scope. */
export function resolveConfig(scope) {
    return mergeConfig(scope.get());
}
/** Normalize the configured base URL: strip trailing slashes, keep http(s). */
export function upstreamBase(cfg) {
    return (cfg?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}
/** Resolve + guard: the configured upstream and key, or a throw the registry turns into an error result. */
export function requireUpstream(scope) {
    const cfg = resolveConfig(scope);
    if (!cfg.apiKey) {
        throw new Error('supermemory API key not configured — open dsh Settings → Supermemory and paste the API key from localhost:6767.');
    }
    return { base: upstreamBase(cfg), apiKey: cfg.apiKey };
}
/** Resolve the active memory container: settings.activeContainer if set, else DEFAULT_CONTAINER. */
export function activeContainer(scope) {
    const cfg = resolveConfig(scope);
    return cfg.activeContainer?.trim() || DEFAULT_CONTAINER;
}
/** Persist the active memory container choice (the settings card's single
 * write path — via POST /config or the dedicated PUT /active-container). */
export async function setActiveContainer(scope, tag) {
    const clean = tag.trim();
    if (!clean)
        throw new Error('containerTag (non-empty string) is required');
    await scope.update({ activeContainer: clean });
}
/** Narrow one tool argument to a string with a fallback. */
export function argString(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}
/** Create the settings scope for the "supermemory" namespace (live applies). */
export function registerSupermemorySettings(ctx) {
    return ctx.settings.register('supermemory', SUPERMEMORY_SCHEMA, {
        applies: 'live',
    });
}
