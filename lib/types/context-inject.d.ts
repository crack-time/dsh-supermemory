/**
 * Memory-context contributions registered through the native prompt channel.
 *
 * This module provides the two `systemPrompt.context()` registrations the
 * plugin contributes:
 *   - STATIC context (environment block + static profile): set-once, sits at
 *     the head of the conversation.
 *   - DYNAMIC recall: on every assembly the current user message is searched
 *     synchronously and the top hits are rendered.
 *
 * Both flow through the agent-loop's normal assemble → project() path, so the
 * timing is exactly the native step-level one: the agent-loop evaluates
 * context on every step, and only appends a snapshot user/message when the
 * rendered text changed (RuntimeContextProjection.project()). This is what
 * makes the injection land before the first `deriveMessages()` of a turn and
 * stay native-consistent across tool-call steps.
 *
 * Attribution: these join the native runtime-context snapshot, so their
 * rendered row carries the native @deepseek-ai/dsh-system-prompt label (the
 * agent-loop hardcodes the snapshot source). Names still use the "supermemory:"
 * prefix so the sections are self-describing inside the snapshot.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * Assemble the static context text: the dynamic environment block (cwd, git,
 * platform, shell, OS, uv) followed by the memory profile banner. Called as
 * the `text` provider for the static context registration.
 */
export declare function staticContextText(ctx: Context, session: Session, container: string, profile: string): string;
/** Release per-session recall state (call from session/disposed). */
export declare function clearRecallState(sessionId: string): void;
/** Per-message recall tuning, shared by the inbox handlers and renderer. */
export interface RecallConfig {
    recallTopK: number;
    recallMaxChars: number;
    recallThreshold: number;
    recallEnabled: boolean;
}
/** A synchronous recall search implementation (real: worker/exec; tests: fake). */
export type RecallSearcher = (scope: SettingsScope<any>, container: string, query: string, limit: number, threshold: number) => Array<{
    memory: string;
}>;
/** Resolve the live per-message recall config from the settings scope. */
export declare function recallConfigOf(scope: SettingsScope<any>): RecallConfig;
/**
 * Pre-compute the recall for one human user message and cache it by signature.
 * Called synchronously from `agent/inbox/inserted` (the message is already in
 * the inbox, before it is claimed): blocking here deliberately pins the send
 * path until the search lands, so the agent wakes with the cache already warm
 * ("make the agent busy until the search is done"). No-op when the signature
 * is already cached (a message is only ever searched once per session).
 * @param search - injectable searcher; defaults to the real worker-based one
 *                 and is overridden in tests to avoid a live upstream.
 */
export declare function prewarmRecall(scope: SettingsScope<any>, session: Session, container: string, cfg: RecallConfig, content: readonly unknown[], search?: RecallSearcher): void;
/**
 * Bind the message currently being claimed so the text() provider renders ITS
 * recall. Called synchronously from `agent/inbox/claimed` (right before the
 * step's assembly). Cache is usually already warm from prewarmRecall at
 * `inserted`; this does a synchronous fallback search only on a cold miss.
 * @param search - injectable searcher; overridden in tests (see prewarmRecall).
 */
export declare function bindRecall(scope: SettingsScope<any>, session: Session, container: string, cfg: RecallConfig, content: readonly unknown[], search?: RecallSearcher): void;
/**
 * Render the dynamic recall block for the message currently bound to this
 * session (set at `agent/inbox/claimed`). Reads the synchronous cache that the
 * inserted/claimed handlers already populated — no network here, so this is a
 * pure cache read (zero main-thread blocking). Returns '' only when no human
 * message has been bound yet (e.g. no inbox claim for this session).
 */
export declare function dynamicRecallText(session: Session, cfg: RecallConfig): string;
/**
 * Register the plugin's two context contributions through systemPrompt.context().
 * `resolve` supplies the per-session container + static profile (caller owns
 * those caches). Scope holds settings; `superCtx` is the plugin context for the
 * environment block. Returns the disposers.
 */
export declare function registerMemoryContexts(scopedCtx: {
    systemPrompt: {
        context(c: {
            name: string;
            order: number;
            text: (ctx: {
                agent?: {
                    session?: Session;
                };
            }) => string;
        }): () => void;
    };
}, superCtx: Context, scope: SettingsScope<any>, resolve: (session?: Session) => {
    container: string;
    profile: string;
}): Array<() => void>;
