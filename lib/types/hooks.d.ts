/**
 * Deterministic session hooks:
 *  - session/created → inject the ACTIVE container's memory profile (retry
 *    while the managed upstream is still booting on a fresh dsh web start).
 *  - turn/end → persist each finished turn as one supermemory document
 *    (low-value turns filtered out first). Subagent sessions are skipped
 *    for both hooks.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Register the session/created injection and per-turn persistence. */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
