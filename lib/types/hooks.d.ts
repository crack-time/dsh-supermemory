/**
 * Deterministic session hooks:
 *  - activation -> pre-warm the active container's static profile into a global
 *    cache (see prewarmProfile); a session/created fallback tops up a container
 *    that changed after boot. The context text provider reads this cache
 *    synchronously on the first model step.
 *  - agent/inbox/inserted|claimed -> drive per-message dynamic recall: prewarm
 *    the search at insert (pinning the send path until it lands) and bind the
 *    claimed message so the context text provider renders its recall from cache.
 *  - systemPrompt.context() registrations (context-inject.ts) -> static
 *    environment+profile and per-message recall flow through the native
 *    assemble → project() step-level path.
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
/** Pre-warm the active container's static profile once (fire-and-forget). */
export declare function prewarmProfile(scope: SettingsScope<any>): Promise<void>;
/** Register the session hooks (context registration + turn persistence). */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
