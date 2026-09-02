/**
 * Settings schema + config resolution for the "supermemory" namespace.
 *
 * Owns: the schemastery schema, the resolved-config shape, the upstream
 * helpers (base URL / api key guards) and the active-container resolution.
 * Everything else in the plugin imports from here; this module never
 * imports back.
 */
import z from '@deepseek-ai/schemastery';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import type { Context } from '@deepseek-ai/cordis';

export const DEFAULT_BASE_URL = 'http://localhost:6767';
export const DEFAULT_CONTAINER = 'sm_project_default';
// The managed supermemory server needs an OpenAI-compatible endpoint to embed
// with. Leave the defaults empty — a user running the managed server sets their
// own values in the settings card (a plugin default must not bake in one
// person's proprietary proxy/endpoint).
export const DEFAULT_OPENAI_BASE_URL = '';
export const DEFAULT_OPENAI_MODEL = '';

/** Resolved settings shape for the "supermemory" namespace. */
export interface SupermemoryConfig {
    baseUrl: string;
    apiKey: string;
    /** Managed local server: start/stop supermemory-server alongside dsh web. */
    serverPath: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    /** Currently selected memory container tag (persisted across sessions). */
    activeContainer: string;
}

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

function mergeConfig(value: unknown): SupermemoryConfig {
    const v = (value ?? {}) as Partial<SupermemoryConfig>;
    return {
        baseUrl: (v.baseUrl as string) ?? DEFAULT_BASE_URL,
        apiKey: (v.apiKey as string) ?? '',
        serverPath: (v.serverPath as string) ?? '',
        openaiApiKey: (v.openaiApiKey as string) ?? '',
        openaiBaseUrl: (v.openaiBaseUrl as string) ?? DEFAULT_OPENAI_BASE_URL,
        openaiModel: (v.openaiModel as string) ?? DEFAULT_OPENAI_MODEL,
        activeContainer: (v.activeContainer as string) ?? '',
    };
}

/** Resolve the effective configuration from a settings scope. */
export function resolveConfig(scope: SettingsScope<any>): SupermemoryConfig {
    return mergeConfig(scope.get());
}

/** Normalize the configured base URL: strip trailing slashes, keep http(s). */
export function upstreamBase(cfg: Partial<SupermemoryConfig> | undefined): string {
    return (cfg?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

/** Resolve + guard: the configured upstream and key, or a throw the registry turns into an error result. */
export function requireUpstream(scope: SettingsScope<any>): { base: string; apiKey: string } {
    const cfg = resolveConfig(scope);
    if (!cfg.apiKey) {
        throw new Error('supermemory API key not configured — open dsh Settings → Supermemory and paste the API key from localhost:6767.');
    }
    return { base: upstreamBase(cfg), apiKey: cfg.apiKey };
}

/** Resolve the active memory container: settings.activeContainer if set, else DEFAULT_CONTAINER. */
export function activeContainer(scope: SettingsScope<any>): string {
    const cfg = resolveConfig(scope);
    return cfg.activeContainer?.trim() || DEFAULT_CONTAINER;
}

/** Persist the active memory container choice (the settings card's single
 * write path — via POST /config or the dedicated PUT /active-container). */
export async function setActiveContainer(scope: SettingsScope<any>, tag: string): Promise<void> {
    const clean = tag.trim();
    if (!clean) throw new Error('containerTag (non-empty string) is required');
    await scope.update({ activeContainer: clean });
}

/** Narrow one tool argument to a string with a fallback. */
export function argString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Create the settings scope for the "supermemory" namespace (live applies). */
export function registerSupermemorySettings(ctx: Context): SettingsScope<any> {
    return ctx.settings.register('supermemory', SUPERMEMORY_SCHEMA, {
        applies: 'live',
    });
}
