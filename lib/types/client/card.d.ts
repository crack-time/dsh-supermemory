/**
 * Settings-dialog card for the "supermemory" namespace — JSX only.
 *
 * Fields: base URL, API key, managed server + OpenAI settings and the active
 * memory-space dropdown (create/switch). All state and IO live in the
 * useSupermemoryCard hook (card-state.ts); locale in card-locale.ts; CSS in
 * card-css.ts — the component stays focused on rendering.
 */
import { type CardTextKey } from './card-locale.ts';
export type { ManagedStatus, Status, CardState } from './card-state.ts';
/** Props consumed by the card component (translation + patch channel). */
export interface CardProps {
    t?: (key: CardTextKey) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{
        ok: boolean;
        error?: string;
    }>;
}
export declare function SupermemorySettingsCard(props: CardProps): import("react").JSX.Element;
