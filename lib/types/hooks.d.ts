/**
 * Deterministic session hooks:
 *  - session/created -> snapshot the container + fetch profile into cache;
 *    the systemPrompt.section() registrations read the cache synchronously
 *    on every model step, so no agent.inject() is needed.
 *  - user/message -> per-message dynamic recall: dedupe + synchronously search
 *    the message, then append it as a dedicated `user/message` (source.kind =
 *    "plugin", source.plugin = "@crack/dsh-supermemory") so the chat renders a
 *    "Context injection @crack/dsh-supermemory" row; the injected message's own
 *    event is skipped (source is not "user"), so it cannot recurse.
 *  - turn/end -> accumulate the turn transcript and PATCH it into the
 *    session's single supermemory document (each session owns one doc).
 *    Subagent sessions are skipped for all of the above.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Look up the container a session was bound to at creation time. */
export declare function getSessionContainer(sessionId: string): string | undefined;
/** Override the session container snapshot (used by the input-bar selector). */
export declare function setSessionContainer(sessionId: string, tag: string): void;
export interface SessionDocState {
    /** Upstream document id for this session, once created. */
    docId?: string;
    /** Cumulative transcript text since session creation. */
    fullText: string;
    /** True while a PATCH is in flight — skip new turns until it settles. */
    patching: boolean;
}
/** Register the systemPrompt.section() + session hooks. */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
