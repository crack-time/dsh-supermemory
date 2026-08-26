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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { CARD_LOCALE } from './card-locale.ts';
/**
 * Local declaration merging for the seats this plugin occupies.
 *
 * The real services are declared by the dsh web shell at runtime
 * (dsh-client-locale's `ctx.locale`, dsh-client-ui-settings-plugins'
 * `settings.plugin.item` keyed slot, dsh-client-ui-conversation's
 * `conversation.session.header.actions` list slot). Those packages are
 * NOT build-time dependencies of this plugin, so we mirror just the faces
 * we touch — the slot keys, their owners, and our locale namespace.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** One plugin's card inside the plugin configuration section. */
        'settings.plugin.item': {
            kind: 'keyed';
            scope: 'root';
            owner: {
                children?: never;
            };
        };
        /** Badge chip in the session header (next to the agent-preset label). */
        'conversation.session.header.actions': {
            kind: 'list';
            scope: 'session';
        };
    }
    interface LocaleNamespaceMap {
        /** Card copy namespace (keys in card-locale.ts). */
        'dsh-supermemory': keyof typeof CARD_LOCALE.zh;
    }
}
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
