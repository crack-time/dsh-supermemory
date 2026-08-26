import { type CardTextKey } from './card-locale.ts';
interface CardProps {
    /** Translation face injected by the slot host (keyed namespace). */
    t?: (key: CardTextKey) => string;
    applyPatch?: (patch: Record<string, unknown>) => Promise<{
        ok: boolean;
        error?: string;
    }>;
}
export declare function SupermemorySettingsCard(props: CardProps): import("react").JSX.Element;
export {};
