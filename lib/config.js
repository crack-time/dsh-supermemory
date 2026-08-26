/**
 * Settings schema + config resolution for the "supermemory" namespace.
 *
 * Owns: the schemastery schema, the resolved-config shape, the upstream
 * helpers (base URL / api key guards) and the active-container resolution.
 * Everything else in the plugin imports from here; this module never
 * imports back.
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
export const DEFAULT_BASE_URL = 'http://localhost:6767';
export const DEFAULT_CONTAINER = 'sm_project_default';
export const DEFAULT_OPENAI_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
export const DEFAULT_OPENAI_MODEL = 'mimo-v2.5';
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
        activeContainer: v.activeContainer ?? '',
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
    return ctx.settings.register(settingsNamespace('supermemory'), SUPERMEMORY_SCHEMA, {
        applies: 'live',
    });
}
