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
import { SupermemorySettingsCard } from './card.tsx';
import { MemorySpaceBadge } from './header-badge.tsx';
import { CARD_LOCALE } from './card-locale.ts';
import { injectCardCss } from './card-css.ts';
import { API_URLS } from './api.ts';

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
            owner: { children?: never };
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
export const inject = ['locale', 'slots'];

const DICT = 'dsh-supermemory';

export function apply(ctx: ClientContext) {
    // Card styles (native PluginCard look, injected once).
    injectCardCss();
    // Locale dictionary for the card (title / description / labels / hints).
    ctx.locale?.register?.(DICT, CARD_LOCALE);
    const slots = ctx.slots;

    // ── Header badge: shows the active memory container name ──────────
    // Registers into the session header actions list so it renders as a
    // small badge chip next to the agent-preset label.
    slots?.inject?.('conversation.session.header.actions', function* () {
        yield slots.register({
            name: 'conversation.session.header.actions',
            id: 'supermemory-space',
            order: -5, // just after agent-preset (order -10)
            locale: DICT,
            inject: (sessionId: string) => ({
                hooks: {},
                sessionId,
            }),
        }, MemorySpaceBadge);
    });

    // ── Settings dialog card ──────────────────────────────────────────
    // One `settings.plugin.item` slot entry keyed by the 'supermemory'
    // namespace. The dialog dispatches it only while the host serves that
    // namespace, so this stays invisible without the host half.
    slots?.inject?.('settings.plugin.item', function* () {
        yield slots.register({
            name: 'settings.plugin.item',
            key: 'supermemory',
            locale: DICT,
            inject: () => ({
                hooks: {},
                applyPatch: async (patch: Record<string, unknown>) => {
                    try {
                        const res = await fetch(API_URLS.config, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ patch }),
                        });
                        if (!res.ok) {
                            const text = await res.text();
                            return { ok: false, error: text.slice(0, 200) };
                        }
                        return { ok: true };
                    }
                    catch {
                        // Network failure: report to the card instead of throwing.
                        return { ok: false, error: 'network' };
                    }
                },
            }),
        }, SupermemorySettingsCard);
    });
}
