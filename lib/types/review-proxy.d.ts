import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
export type ReviewProxyState = 'no-path' | 'running' | 'starting' | 'stopped' | 'missing-file' | 'error';
export interface ReviewProxySnapshot {
    state: ReviewProxyState;
    pid?: number;
    file?: string;
    port?: number;
    error?: string;
}
export declare class ReviewProxy {
    private child;
    private info;
    private lastSig;
    snapshot(): ReviewProxySnapshot;
    private signature;
    /**
     * Reconcile with current config: stop when the path is cleared, (re)start
     * when path/port changed, keep running otherwise. Called on activation and
     * after every config save.
     */
    sync(scope: SettingsScope<any>, ctx: Context): Promise<void>;
    /** Launch the review-proxy child. Safe to call repeatedly. */
    start(scope: SettingsScope<any>, ctx: Context): Promise<void>;
    /** Kill only the process this plugin spawned. */
    stop(ctx: Context): Promise<ReviewProxySnapshot>;
}
