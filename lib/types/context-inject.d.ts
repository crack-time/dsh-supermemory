/**
 * Deterministic memory-context injection for the model stream.
 *
 * This is the plugin's own "context" channel: everything injected here is
 * appended as a dedicated `user/message` (source.kind = "plugin",
 * source.plugin = "@crack/dsh-supermemory") so the chat renders a
 * "Context injection @crack/dsh-supermemory" row and the message is present in
 * the model-visible surface on the very next `deriveMessages()` snapshot.
 *
 * Two kinds of content:
 *   - STATIC context (environment block + static profile): assembled once per
 *     session (set-once), injected at session creation so it sits at the head
 *     of the conversation and is always in the surface. This replaces the old
 *     `systemPrompt.section()` registrations, which were rendered into the
 *     system role and therefore never showed up as a context row.
 *   - DYNAMIC recall: on every real user message a semantic search runs
 *     synchronously into a cache and the top hits are appended. Because the
 *     append is synchronous (see Session.append), the recall lands before the
 *     first `deriveMessages()` snapshot of that turn — so a single-step turn
 *     (no tool call) no longer drops it.
 *
 * Why not `systemPrompt.context()`: the agent-loop's RuntimeContextProjection
 * hardcodes the source plugin to @deepseek-ai/dsh-system-prompt, so anything
 * registered there cannot be labelled with our own plugin id. Appending our
 * own `user/message` is the only way to keep the @crack/dsh-supermemory label.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * Assemble the static context text: the dynamic environment block (cwd, git,
 * platform, shell, OS, uv) followed by the memory profile banner. Returns ''
 * when nothing is available to inject.
 */
export declare function contextMessageText(ctx: Context, session: Session, container: string, profile: string): string;
/**
 * Inject the static context block once. The caller decides the session's
 * container + profile (snapshot at session creation); this only renders and
 * appends. Subagent sessions are skipped by the caller.
 */
export declare function injectStaticContext(ctx: Context, session: Session, container: string, profile: string): void;
/** Release per-session recall state (call from session/disposed). */
export declare function clearRecallState(sessionId: string): void;
/**
 * Hook a real user message: normalize + dedup, then SYNCHRONOUSLY search into
 * cache and append the rendered recall (labelled context row). Returns the
 * number of hits injected (so the caller can log it). The injected message's
 * own `user/message` event is skipped by the caller (source is not "user"), so
 * this cannot recurse.
 *
 * `resolveContainer` maps a session to its active memory container (the caller
 * keeps the per-session snapshot; this module stays container-agnostic).
 */
export declare function injectDynamicRecall(scope: SettingsScope<any>, session: Session, event: unknown, resolveContainer: (session: Session) => string): number;
