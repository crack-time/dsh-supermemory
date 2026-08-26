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
export declare const DEFAULT_BASE_URL = "http://localhost:6767";
export declare const DEFAULT_CONTAINER = "code-dev";
export declare const DEFAULT_OPENAI_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
export declare const DEFAULT_OPENAI_MODEL = "mimo-v2.5";
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
export declare const SUPERMEMORY_SCHEMA: z<Schemastery.ObjectS<{
    baseUrl: z<string, string>;
    apiKey: z<string, string>;
    serverPath: z<string, string>;
    openaiApiKey: z<string, string>;
    openaiBaseUrl: z<string, string>;
    openaiModel: z<string, string>;
    activeContainer: z<string, string>;
}>, Schemastery.ObjectT<{
    baseUrl: z<string, string>;
    apiKey: z<string, string>;
    serverPath: z<string, string>;
    openaiApiKey: z<string, string>;
    openaiBaseUrl: z<string, string>;
    openaiModel: z<string, string>;
    activeContainer: z<string, string>;
}>>;
/** Resolve the effective configuration from a settings scope. */
export declare function resolveConfig(scope: SettingsScope<any>): SupermemoryConfig;
/** Normalize the configured base URL: strip trailing slashes, keep http(s). */
export declare function upstreamBase(cfg: Partial<SupermemoryConfig> | undefined): string;
/** Resolve + guard: the configured upstream and key, or a throw the registry turns into an error result. */
export declare function requireUpstream(scope: SettingsScope<any>): {
    base: string;
    apiKey: string;
};
/** Resolve the active memory container: settings.activeContainer if set, else DEFAULT_CONTAINER. */
export declare function activeContainer(scope: SettingsScope<any>): string;
/** Persist the active memory container choice (used by the settings card
 * via POST /config and by the select-memory tool — one shared write path). */
export declare function setActiveContainer(scope: SettingsScope<any>, tag: string): Promise<void>;
/** Narrow one tool argument to a string with a fallback. */
export declare function argString(value: unknown, fallback: string): string;
/** Create the settings scope for the "supermemory" namespace (live applies). */
export declare function registerSupermemorySettings(ctx: any): SettingsScope<any>;
