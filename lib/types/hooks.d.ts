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
 *  - domain/changed (workspace registry) -> archive-time persistence: when a
 *    session enters the registry's archivedSessionIds, recompute its FULL
 *    transcript from the persistence-backed event history (live or cold) and
 *    upsert it into supermemory (idempotent PATCH overwrite). This replaces the
 *    old per-turn write that re-ingested the transcript (and re-ran the
 *    upstream LLM filter) on every turn. Subagent sessions are skipped.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Look up the container a session was bound to at creation time. */
export declare function getSessionContainer(sessionId: string): string | undefined;
/** Override the session container snapshot (used by the input-bar selector). */
export declare function setSessionContainer(sessionId: string, tag: string): void;
/** Pre-warm the active container's static profile if missing or stale. */
export declare function prewarmProfile(scope: SettingsScope<any>): Promise<void>;
/** Register the session hooks (context registration + turn persistence). */
export declare function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
