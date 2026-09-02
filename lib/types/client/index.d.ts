/**
 * Client loader entry for the Supermemory proxy.
 *
 * Registers the settings-dialog card for the "supermemory" namespace
 * (base URL + API key + memory-space dropdown + a connection test) and
 * a header badge that shows the active memory container name in the
 * session header area. The memory/search experience stays on Supermemory's
 * own bundled dashboard (localhost:6767); this plugin only makes that
 * server reachable through dsh's own origin.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
type LocaleRuntime = {
    register(namespace: string, dict: Record<string, Record<string, string>>): void | Promise<void>;
};
declare module '@deepseek-ai/cordis' {
    interface Context {
        locale?: LocaleRuntime;
    }
}
/** Client-side service dependencies (runtime inject declaration; mirrors the
 * package.json dsh.client.inject metadata). */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
