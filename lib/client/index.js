import { SupermemorySettingsCard } from './card.js';
import { CARD_LOCALE } from './card-locale.js';
import { injectCardCss } from './card-css.js';
import { API_URLS } from './api.js';
/** Client-side service dependencies (runtime inject declaration; mirrors the
 * package.json dsh.client.inject metadata). */
export const inject = ['locale', 'slots'];
const DICT = 'dsh-supermemory';
export function apply(ctx) {
    // Card styles (native PluginCard look, injected once).
    injectCardCss();
    // Locale dictionary for the card (title / description / labels / hints).
    ctx.locale?.register?.(DICT, CARD_LOCALE);
    // Settings-dialog card: one `settings.plugin.item` slot entry keyed by the
    // 'supermemory' namespace. The dialog dispatches it only while the host
    // serves that namespace, so this stays invisible without the host half.
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
