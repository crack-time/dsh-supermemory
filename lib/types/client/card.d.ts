/** Locale dictionary for the card. */
export declare const CARD_LOCALE: {
    zh: {
        title: string;
        description: string;
        baseUrl: string;
        baseUrlHint: string;
        apiKey: string;
        apiKeyHint: string;
        show: string;
        hide: string;
        save: string;
        saving: string;
        discard: string;
        test: string;
        testing: string;
        unsaved: string;
        saveFailed: string;
        saved: string;
        expand: string;
        collapse: string;
        checkFailed: string;
        ok: string;
        checking: string;
        loadFailed: string;
        emptyKey: string;
        serverPath: string;
        serverPathHint: string;
        openaiApiKey: string;
        openaiBaseUrl: string;
        openaiModel: string;
        managedStatus: string;
        mgtNoPath: string;
        mgtExternal: string;
        mgtRunning: string;
        mgtStarting: string;
        mgtStopped: string;
        mgtMissingExe: string;
        mgtError: string;
    };
    en: {
        title: string;
        description: string;
        baseUrl: string;
        baseUrlHint: string;
        apiKey: string;
        apiKeyHint: string;
        show: string;
        hide: string;
        save: string;
        saving: string;
        discard: string;
        test: string;
        testing: string;
        unsaved: string;
        saveFailed: string;
        saved: string;
        expand: string;
        collapse: string;
        checkFailed: string;
        ok: string;
        checking: string;
        loadFailed: string;
        emptyKey: string;
        serverPath: string;
        serverPathHint: string;
        openaiApiKey: string;
        openaiBaseUrl: string;
        openaiModel: string;
        managedStatus: string;
        mgtNoPath: string;
        mgtExternal: string;
        mgtRunning: string;
        mgtStarting: string;
        mgtStopped: string;
        mgtMissingExe: string;
        mgtError: string;
    };
};
interface CardProps {
    t?: (key: string) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{
        ok: boolean;
        error?: string;
    }>;
}
/**
 * Card styles — same values as the built-in PluginCard (via the skin card's
 * recreation of PluginCard.module.css), keyed off [data-supermemory-settings]
 * so they never leak outside this card.
 */
export declare const CARD_CSS = "\n[data-supermemory-settings].sm-settings-card {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-3);\n  border-radius: 12px;\n  list-style: none;\n  transition: border-color 0.16s, background 0.16s;\n}\n[data-supermemory-settings].sm-settings-card:hover {\n  border-color: var(--dsw-alias-label-dimmed);\n}\n[data-supermemory-settings].sm-settings-card-open {\n  background: var(--dsw-alias-bg-layer-2);\n  border-color: var(--dsw-alias-label-dimmed);\n}\n[data-supermemory-settings] .sm-settings-header {\n  appearance: none;\n  width: 100%;\n  font: inherit;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: 0 0;\n  border: 0;\n  border-radius: 12px;\n  align-items: center;\n  gap: 12px;\n  padding: 14px 16px;\n  display: flex;\n}\n[data-supermemory-settings] .sm-settings-header:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: -2px;\n}\n[data-supermemory-settings] .sm-settings-headText {\n  flex-direction: column;\n  flex: 1;\n  gap: 4px;\n  min-width: 0;\n  display: flex;\n}\n[data-supermemory-settings] .sm-settings-name {\n  color: var(--dsw-alias-label-primary);\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.4;\n}\n[data-supermemory-settings] .sm-settings-description {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n  line-height: 1.5;\n}\n[data-supermemory-settings] .sm-settings-chevron {\n  color: var(--dsw-alias-label-tertiary);\n  flex: none;\n  transition: transform 0.16s;\n}\n[data-supermemory-settings] .sm-settings-chevron-open {\n  transform: rotate(180deg);\n}\n[data-supermemory-settings] .sm-settings-pending {\n  white-space: nowrap;\n  background: var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.06));\n  color: var(--dsw-alias-label-secondary);\n  border-radius: 999px;\n  flex: none;\n  padding: 1px 8px;\n  font-size: 11px;\n  font-weight: 500;\n  line-height: 17px;\n}\n[data-supermemory-settings] .sm-settings-body {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  margin: 0 16px;\n  padding-bottom: 8px;\n  flex-direction: column;\n  gap: 12px;\n  display: flex;\n}\n[data-supermemory-settings] .sm-settings-row {\n  flex-direction: column;\n  gap: 4px;\n  display: flex;\n}\n[data-supermemory-settings] .sm-settings-label {\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  line-height: 20px;\n}\n[data-supermemory-settings] input[type=\"text\"],\n[data-supermemory-settings] input[type=\"password\"] {\n  box-sizing: border-box;\n  width: 100%;\n  height: 34px;\n  padding: 6px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n}\n[data-supermemory-settings] .sm-settings-hint {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n[data-supermemory-settings] .sm-settings-footer {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  justify-content: flex-end;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 0 4px;\n  display: flex;\n}\n[data-supermemory-settings] .sm-settings-status {\n  min-width: 0;\n  flex: 1;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--dsw-alias-label-tertiary);\n  overflow-wrap: anywhere;\n}\n[data-supermemory-settings] .sm-settings-status-ok {\n  color: var(--dsw-alias-state-success-primary);\n}\n[data-supermemory-settings] .sm-settings-status-err {\n  color: var(--dsw-alias-state-error-primary);\n}\n[data-supermemory-settings] .sm-settings-failed {\n  min-width: 0;\n  color: var(--dsw-alias-state-error-primary);\n  flex: 1;\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n}\n[data-supermemory-settings] .sm-settings-test,\n[data-supermemory-settings] .sm-settings-discard,\n[data-supermemory-settings] .sm-settings-save {\n  appearance: none;\n  font: inherit;\n  cursor: pointer;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  padding: 5px 14px;\n  font-size: 13px;\n  line-height: 1.5;\n}\n[data-supermemory-settings] .sm-settings-test,\n[data-supermemory-settings] .sm-settings-discard {\n  border-color: var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-secondary);\n  background: 0 0;\n}\n[data-supermemory-settings] .sm-settings-save {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-button-primary-invert);\n}\n[data-supermemory-settings] .sm-settings-test:disabled,\n[data-supermemory-settings] .sm-settings-save:disabled,\n[data-supermemory-settings] .sm-settings-discard:disabled {\n  opacity: 0.55;\n  cursor: default;\n}\n[data-supermemory-settings] .sm-settings-check {\n  flex-direction: row;\n  align-items: flex-start;\n  gap: 8px;\n}\n[data-supermemory-settings] .sm-settings-check input[type=\"checkbox\"] {\n  width: auto;\n  height: auto;\n  margin-top: 3px;\n  accent-color: var(--dsw-alias-brand-primary);\n  cursor: pointer;\n}\n[data-supermemory-settings] .sm-settings-hint.sm-settings-block {\n  display: block;\n  margin-top: 2px;\n}\n[data-supermemory-settings] .sm-settings-serverrow {\n  align-items: center;\n  gap: 8px;\n  display: flex;\n  flex-wrap: wrap;\n}\n";
/** Inject the card styles once (idempotent; safe to call from apply()). */
export declare function injectCardCss(): void;
export declare function SupermemorySettingsCard(props: CardProps): import("react").JSX.Element;
export {};
