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
import { execFileSync } from 'node:child_process';
import { requireUpstream, resolveConfig } from './config.ts';
import { messageText } from './transcript.ts';
import { environmentBlock } from './environment.ts';
import { SearchWorker } from './search-worker.ts';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { recallSignature, renderRecall, filterSearchHits } from './recall.ts';

/** One persistent search worker shared by every session (spawned on first use). */
const searchWorker = new SearchWorker();

// ---------------------------------------------------------------------------
// Static context block (environment + static profile), set-once per session
// ---------------------------------------------------------------------------

/**
 * Assemble the static context text: the dynamic environment block (cwd, git,
 * platform, shell, OS, uv) followed by the memory profile banner. Returns ''
 * when nothing is available to inject.
 */
export function contextMessageText(
    ctx: Context,
    session: Session,
    container: string,
    profile: string,
): string {
    const env = environmentBlock(ctx, session);
    const banner = profile
        ? '[Memory Context (from local supermemory)]\n\n' +
          'Active memory space: ' + container + '\n\n' +
          profile +
          '\n\n[SYSTEM INSTRUCTION] Memory queries default to the active memory space above.'
        : '';
    return [env, banner].filter((s) => s.length > 0).join('\n\n');
}

/** Append one labelled context message. No-op on empty text. */
function appendContextMessage(session: Session, text: string): void {
    if (!text) return;
    session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: '@crack/dsh-supermemory' },
    }), { surfaceOp: 'append' });
}

/**
 * Inject the static context block once. The caller decides the session's
 * container + profile (snapshot at session creation); this only renders and
 * appends. Subagent sessions are skipped by the caller.
 */
export function injectStaticContext(
    ctx: Context,
    session: Session,
    container: string,
    profile: string,
): void {
    appendContextMessage(session, contextMessageText(ctx, session, container, profile));
}

// ---------------------------------------------------------------------------
// Per-message dynamic recall
//
// Deterministic sync search: cordis `ctx.emit()` dispatches session/event
// handlers synchronously and does not await their returned promises, so an
// async search can't be guaranteed to land before the prompt is assembled. We
// therefore run the search SYNCHRONOUSLY (resident worker, or an inline `node
// -e` subprocess fallback) so the cache is populated before emit returns.
// ---------------------------------------------------------------------------

interface RecallState {
    /** Normalized user-message texts already searched this session (dedup). */
    searched: Set<string>;
    /** Search hits keyed by the normalized message text. */
    bySignature: Map<string, Array<{ memory: string }>>;
}

const recallCache = new Map<string, RecallState>();

function recallState(sessionId: string): RecallState {
    let state = recallCache.get(sessionId);
    if (!state) {
        state = { searched: new Set(), bySignature: new Map() };
        recallCache.set(sessionId, state);
    }
    return state;
}

/** Release per-session recall state (call from session/disposed). */
export function clearRecallState(sessionId: string): void {
    recallCache.delete(sessionId);
}

function recallSearchSync(
    scope: SettingsScope<any>,
    container: string,
    query: string,
    limit: number,
): Array<{ memory: string }> {
    try {
        const { base, apiKey } = requireUpstream(scope);
        const threshold = resolveConfig(scope).recallThreshold;
        try {
            return searchWorker.search(base, apiKey, query, container, limit, threshold);
        } catch {
            return recallSearchExec(base, apiKey, query, container, limit, threshold);
        }
    } catch { /* no key / upstream unreachable — silently skip recall */ }
    return [];
}

/** One-shot synchronous search via a temporary `node -e` subprocess (fallback). */
function recallSearchExec(
    base: string,
    apiKey: string,
    query: string,
    container: string,
    limit: number,
    threshold: number,
): Array<{ memory: string }> {
    try {
        const script =
            '(async () => {\n' +
            '  const base = process.env.SM_BASE;\n' +
            '  const key = process.env.SM_KEY;\n' +
            '  try {\n' +
            '    const r = await fetch(base + "/v4/search", {\n' +
            '      method: "POST",\n' +
            '      headers: { authorization: "Bearer " + key, "content-type": "application/json" },\n' +
            '      body: JSON.stringify({ q: process.env.SM_Q, containerTag: process.env.SM_CONTAINER, threshold: +process.env.SM_THRESHOLD, limit: +process.env.SM_LIMIT })\n' +
            '    });\n' +
            '    process.stdout.write(await r.text());\n' +
            '  } catch (e) { process.exitCode = 1; }\n' +
            '})();';
        const out = execFileSync(process.execPath, ['-e', script], {
            env: {
                ...process.env,
                SM_BASE: base,
                SM_KEY: apiKey,
                SM_Q: query,
                SM_CONTAINER: container,
                SM_LIMIT: String(limit),
                SM_THRESHOLD: String(threshold),
            },
            encoding: 'utf8',
            timeout: 8000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        const data = JSON.parse(out) as {
            memories?: Array<unknown>;
            results?: Array<unknown>;
        };
        return filterSearchHits(data.results ?? data.memories ?? [], threshold);
    } catch { /* upstream down / timeout — silently skip recall for this message */ }
    return [];
}

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
export function injectDynamicRecall(
    scope: SettingsScope<any>,
    session: Session,
    event: unknown,
    resolveContainer: (session: Session) => string,
): number {
    const e = event as { type?: string; data?: { source?: { kind?: string }; content?: readonly unknown[] } };
    if (e.data?.source?.kind !== 'user') return 0;
    const text = messageText(e.data.content ?? []);
    const norm = recallSignature(text);
    if (!norm) return 0;
    const cfg = resolveConfig(scope);
    if (!cfg.recallEnabled) return 0;
    const state = recallState(session.id);
    let hits: Array<{ memory: string }>;
    if (state.searched.has(norm)) {
        hits = state.bySignature.get(norm) ?? [];
    } else {
        state.searched.add(norm);
        hits = recallSearchSync(scope, resolveContainer(session), norm, cfg.recallTopK);
        if (hits.length > 0) state.bySignature.set(norm, hits);
    }
    if (hits.length === 0) return 0;
    const rendered = renderRecall(hits, cfg.recallTopK, cfg.recallMaxChars);
    if (!rendered) return 0;
    appendContextMessage(session, rendered);
    return hits.length;
}
