import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Look up the container a session was bound to at creation time. */
export declare function getSessionContainer(sessionId: string): string | undefined;
/** Override the session's container snapshot (used by the input-bar selector). */
export declare function setSessionContainer(sessionId: string, tag: string): void;
/** Register the systemPrompt.context() + session hooks. */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
