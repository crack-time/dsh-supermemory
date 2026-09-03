/**
 * Deterministic session hooks:
 *  - session/created -> snapshot the container + fetch profile into a cache
 *    the context text provider reads synchronously on the first model step.
 *  - systemPrompt.context() registrations (context-inject.ts) -> the static
 *    environment+profile block and the per-message dynamic recall both flow
 *    through the native assemble -> project() step-level path, so they land
 *    before the turn's first deriveMessages() and use native dedup timing.
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
/** Register the session hooks (context registration + turn persistence). */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
