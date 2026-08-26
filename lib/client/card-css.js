/**
 * Card styles for the Supermemory settings card — same values as the built-in
 * PluginCard (via the skin card's recreation of PluginCard.module.css), keyed
 * off [data-supermemory-settings] so they never leak outside this card.
 *
 * Split out of card.tsx: CSS is a build artifact injected once at plugin
 * apply time, not component logic. Kept as an inline string (tsc strips CSS
 * imports; no build-pipeline changes needed).
 */
export const CARD_CSS = `
[data-supermemory-settings].sm-settings-card {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 12px;
  list-style: none;
  transition: border-color 0.16s, background 0.16s;
}
[data-supermemory-settings].sm-settings-card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
[data-supermemory-settings].sm-settings-card-open {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
[data-supermemory-settings] .sm-settings-header {
  appearance: none;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: 0 0;
  border: 0;
  border-radius: 12px;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
[data-supermemory-settings] .sm-settings-headText {
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
  display: flex;
}
[data-supermemory-settings] .sm-settings-name {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
[data-supermemory-settings] .sm-settings-description {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-chevron {
  color: var(--dsw-alias-label-tertiary);
  flex: none;
  transition: transform 0.16s;
}
[data-supermemory-settings] .sm-settings-chevron-open {
  transform: rotate(180deg);
}
[data-supermemory-settings] .sm-settings-pending {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}
[data-supermemory-settings] .sm-settings-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
  flex-direction: column;
  gap: 12px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-row {
  flex-direction: column;
  gap: 4px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-label {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
[data-supermemory-settings] input[type="text"],
[data-supermemory-settings] input[type="password"] {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
[data-supermemory-settings] .sm-settings-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
[data-supermemory-settings] .sm-settings-footer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 12px 0 4px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-status {
  min-width: 0;
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
[data-supermemory-settings] .sm-settings-status-ok {
  color: var(--dsw-alias-state-success-primary);
}
[data-supermemory-settings] .sm-settings-status-err {
  color: var(--dsw-alias-state-error-primary);
}
[data-supermemory-settings] .sm-settings-failed {
  min-width: 0;
  color: var(--dsw-alias-state-error-primary);
  flex: 1;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-test,
[data-supermemory-settings] .sm-settings-discard,
[data-supermemory-settings] .sm-settings-save {
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 13px;
  line-height: 1.5;
}
[data-supermemory-settings] .sm-settings-test,
[data-supermemory-settings] .sm-settings-discard {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  background: 0 0;
}
[data-supermemory-settings] .sm-settings-save {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-button-primary-invert);
}
[data-supermemory-settings] .sm-settings-test:disabled,
[data-supermemory-settings] .sm-settings-save:disabled,
[data-supermemory-settings] .sm-settings-discard:disabled {
  opacity: 0.55;
  cursor: default;
}
[data-supermemory-settings] .sm-settings-check {
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
}
[data-supermemory-settings] .sm-settings-check input[type="checkbox"] {
  width: auto;
  height: auto;
  margin-top: 3px;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
[data-supermemory-settings] .sm-settings-hint.sm-settings-block {
  display: block;
  margin-top: 2px;
}
[data-supermemory-settings] .sm-settings-serverrow {
  align-items: center;
  gap: 8px;
  display: flex;
  flex-wrap: wrap;
}
[data-supermemory-settings] .sm-settings-container-row {
  flex-direction: column;
  gap: 6px;
  display: flex;
}
[data-supermemory-settings] .sm-settings-select {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
[data-supermemory-settings] .sm-settings-select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
[data-supermemory-settings] .sm-settings-container-new {
  flex-direction: row;
  gap: 6px;
  display: flex;
  align-items: center;
}
[data-supermemory-settings] .sm-settings-input-inline {
  flex: 1;
  box-sizing: border-box;
  height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
[data-supermemory-settings] .sm-settings-input-inline:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
`;
let cssInjected = false;
/** Inject the card styles once (idempotent; safe to call from apply()). */
export function injectCardCss() {
    if (cssInjected || typeof document === 'undefined')
        return;
    cssInjected = true;
    try {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-supermemory';
        style.textContent = CARD_CSS;
        document.head.appendChild(style);
    }
    catch { /* document not ready — card markup would fail anyway */ }
}
