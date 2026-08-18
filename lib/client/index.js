/**
 * Client loader entry for the Supermemory proxy — no memory UI.
 *
 * All it does is register the settings-dialog card for the "supermemory"
 * namespace (base URL + API key + a connection test). The memory/search
 * experience stays on Supermemory's own bundled dashboard (localhost:6767);
 * this plugin only makes that server reachable through dsh's own origin.
 */
import { SupermemorySettingsCard, CARD_LOCALE, injectCardCss } from './card.js';
/** Client-side service dependencies (runtime inject declaration; mirrors the
 * package.json dsh.client.inject metadata). */
export const inject = ['locale', 'slots'];
const DICT = 'dsh-supermemory';
export function apply(ctx) {
    // Card styles (native PluginCard look, injected once).
    injectCardCss();
    // Locale dictionary for the card (title / description / labels / hints).
    try {
        ctx.locale?.register?.(DICT, CARD_LOCALE);
    }
    catch { }
    // Settings-dialog card: one `settings.plugin.item` slot entry keyed by the
    // 'supermemory' namespace. The dialog dispatches it only while the host
    // serves that namespace, so this stays invisible without the host half.
    try {
        const slots = ctx.slots;
        slots?.inject?.('settings.plugin.item', function* () {
            yield slots.register({
                name: 'settings.plugin.item',
                key: 'supermemory',
                locale: DICT,
                inject: () => ({
                    hooks: {},
                    applyPatch: async (patch) => {
                        try {
                            const res = await fetch('/plugins/@crack/dsh-supermemory/api/config', {
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
                            return { ok: false, error: 'network' };
                        }
                    },
                }),
            }, SupermemorySettingsCard);
        });
    }
    catch { }
}
