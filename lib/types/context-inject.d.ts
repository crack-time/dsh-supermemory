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
interface RecallConfig {
    recallTopK: number;
    recallMaxChars: number;
    recallThreshold: number;
    recallEnabled: boolean;
}
/**
 * Render the dynamic recall text for the current message, or '' when there is
 * nothing to inject. Looks up the latest real user message (source.kind===
 * "user") in the session's surface, dedups by signature, searches, and returns
 * the bounded hit list. Called synchronously by the context text provider.
 */
export declare function dynamicRecallText(scope: SettingsScope<any>, session: Session, container: string, cfg: RecallConfig): string;
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
export {};
