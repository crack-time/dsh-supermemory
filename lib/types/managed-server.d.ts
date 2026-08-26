import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
export type ManagedState = 'no-path' | 'external' | 'running' | 'starting' | 'stopped' | 'missing-exe' | 'error';
export interface ManagedSnapshot {
    state: ManagedState;
    pid?: number;
    source?: 'spawned' | 'external';
    exe?: string;
    error?: string;
    stderrTail?: string;
}
export declare class ManagedServer {
    private child;
    private info;
    private lastSig;
    snapshot(): ManagedSnapshot;
    private signature;
    /** Is the configured base URL already reachable (health probe against upstream /v3/settings). */
    private probe;
    /**
     * Reconcile with current config: shutdown when the path is cleared,
     * (re)start when config/path/model changed, keep running otherwise. Called
     * on activation and after every config save.
     */
    sync(scope: SettingsScope<any>, ctx: Context): Promise<void>;
    /**
     * Launch the managed process. Skips when already running or when an
     * external instance answers (unless `skipProbe`). Safe to call repeatedly.
     */
    start(scope: SettingsScope<any>, ctx: Context, opts?: {
        skipProbe?: boolean;
    }): Promise<void>;
    /** Kill only the process tree this plugin spawned. Never touches external instances. */
    stop(ctx: Context): Promise<ManagedSnapshot>;
}
