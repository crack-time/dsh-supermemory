/**
 * Deterministic session hooks:
 *  - session/created → snapshot the container + fetch profile into cache;
 *    the systemPrompt.context() registration reads the cache synchronously
 *    on every model step, so no agent.inject() is needed.
 *  - turn/end → persist each finished turn as one supermemory document
 *    (low-value turns filtered out first). Subagent sessions are skipped
 *    for both hooks.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Look up the container a session was bound to at creation time. */
export declare function getSessionContainer(sessionId: string): string | undefined;
/** Register the systemPrompt.context() + session hooks. */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
