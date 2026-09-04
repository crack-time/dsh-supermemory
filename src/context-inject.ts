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
import { execFileSync } from 'node:child_process';
import { requireUpstream, resolveConfig } from './config.ts';
import { messageText } from './transcript.ts';
import { environmentBlock } from './environment.ts';
import { SearchWorker } from './search-worker.ts';
import { recallSignature, renderRecall, filterSearchHits } from './recall.ts';
import { isSubagent } from './session-util.ts';

/** One persistent search worker shared by every session (spawned on first use). */
const searchWorker = new SearchWorker();

// ---------------------------------------------------------------------------
// Static context text (environment block + static profile)
// ---------------------------------------------------------------------------

/**
 * Assemble the static context text: the dynamic environment block (cwd, git,
 * platform, shell, OS, uv) followed by the memory profile banner. Called as
 * the `text` provider for the static context registration.
 */
export function staticContextText(
    ctx: Context,
    session: Session,
    container: string,
    profile: string,
): string {
    const env = environmentBlock(ctx, session);
    const banner = profile
        ? '[Memory Context (from local supermemory)]\n\n' +
          'Active memory space: ' + container + '\n\n' +
          profile
        : '';
    return [env, banner].filter((s) => s.length > 0).join('\n\n');
}

// ---------------------------------------------------------------------------
// Per-message dynamic recall
//
// The search must be SYNCHRONOUS: `systemPrompt.context()` text providers run
// inside assembly, and cordis dispatches handlers synchronously without
// awaiting returned promises, so an async search can't be guaranteed to have
// landed before the snapshot is rendered. We therefore run the search
// synchronously (resident worker, or an inline `node -e` subprocess fallback),
// dedup by signature, and cache the hits per session.
// ---------------------------------------------------------------------------

interface RecallState {
    /** Normalized user-message texts already searched this session (dedup). */
    searched: Set<string>;
    /** Search hits keyed by the normalized message text. */
    bySignature: Map<string, Array<{ memory: string }>>;
}

const recallCache = new Map<string, RecallState>();

/** Agent binding: the recalled norm for the message currently being claimed /
 *  assembled, keyed by session id (set at `agent/inbox/claimed`). Kept — not
 *  cleared after one read — so tool-call steps in the same turn keep rendering
 *  the same recall block (native project() dedup suppresses repeats). */
const recallBinding = new Map<string, { norm: string }>();

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
    recallBinding.delete(sessionId);
}

/** Per-message recall tuning, shared by the inbox handlers and renderer. */
export interface RecallConfig {
    recallTopK: number;
    recallMaxChars: number;
    recallThreshold: number;
    recallEnabled: boolean;
}

/** A synchronous recall search implementation (real: worker/exec; tests: fake). */
export type RecallSearcher = (
    scope: SettingsScope<any>,
    container: string,
    query: string,
    limit: number,
    threshold: number,
) => Array<{ memory: string }>;

/** Resolve the live per-message recall config from the settings scope. */
export function recallConfigOf(scope: SettingsScope<any>): RecallConfig {
    const cfg = resolveConfig(scope);
    return {
        recallTopK: cfg.recallTopK,
        recallMaxChars: cfg.recallMaxChars,
        recallThreshold: cfg.recallThreshold,
        recallEnabled: cfg.recallEnabled,
    };
}

function recallSearchSync(
    scope: SettingsScope<any>,
    container: string,
    query: string,
    limit: number,
    threshold: number,
): Array<{ memory: string }> {
    try {
        const { base, apiKey } = requireUpstream(scope);
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
 * Pre-compute the recall for one human user message and cache it by signature.
 * Called synchronously from `agent/inbox/inserted` (the message is already in
 * the inbox, before it is claimed): blocking here deliberately pins the send
 * path until the search lands, so the agent wakes with the cache already warm
 * ("make the agent busy until the search is done"). No-op when the signature
 * is already cached (a message is only ever searched once per session).
 * @param search - injectable searcher; defaults to the real worker-based one
 *                 and is overridden in tests to avoid a live upstream.
 */
export function prewarmRecall(
    scope: SettingsScope<any>,
    session: Session,
    container: string,
    cfg: RecallConfig,
    content: readonly unknown[],
    search: RecallSearcher = recallSearchSync,
): void {
    if (!cfg.recallEnabled) return;
    const norm = recallSignature(messageText(content));
    if (!norm) return;
    const state = recallState(session.id);
    if (state.bySignature.has(norm)) return;
    state.searched.add(norm);
    state.bySignature.set(norm, search(scope, container, norm, cfg.recallTopK, cfg.recallThreshold));
}

/**
 * Bind the message currently being claimed so the text() provider renders ITS
 * recall. Called synchronously from `agent/inbox/claimed` (right before the
 * step's assembly). Cache is usually already warm from prewarmRecall at
 * `inserted`; this does a synchronous fallback search only on a cold miss.
 * @param search - injectable searcher; overridden in tests (see prewarmRecall).
 */
export function bindRecall(
    scope: SettingsScope<any>,
    session: Session,
    container: string,
    cfg: RecallConfig,
    content: readonly unknown[],
    search: RecallSearcher = recallSearchSync,
): void {
    if (!cfg.recallEnabled) return;
    const norm = recallSignature(messageText(content));
    if (!norm) return;
    const state = recallState(session.id);
    if (!state.bySignature.has(norm)) {
        state.searched.add(norm);
        state.bySignature.set(norm, search(scope, container, norm, cfg.recallTopK, cfg.recallThreshold));
    }
    recallBinding.set(session.id, { norm });
}

/**
 * Render the dynamic recall block for the message currently bound to this
 * session (set at `agent/inbox/claimed`). Reads the synchronous cache that the
 * inserted/claimed handlers already populated — no network here, so this is a
 * pure cache read (zero main-thread blocking). Returns '' only when no human
 * message has been bound yet (e.g. no inbox claim for this session).
 */
export function dynamicRecallText(session: Session, cfg: RecallConfig): string {
    if (!cfg.recallEnabled) return '';
    const bound = recallBinding.get(session.id);
    if (!bound) return '';
    const hits = recallState(session.id).bySignature.get(bound.norm) ?? [];
    return renderRecall(hits, cfg.recallTopK, cfg.recallMaxChars);
}

/**
 * Register the plugin's two context contributions through systemPrompt.context().
 * `resolve` supplies the per-session container + static profile (caller owns
 * those caches). Scope holds settings; `superCtx` is the plugin context for the
 * environment block. Returns the disposers.
 */
export function registerMemoryContexts(
    scopedCtx: { systemPrompt: { context(c: { name: string; order: number; text: (ctx: { agent?: { session?: Session } }) => string }): () => void } },
    superCtx: Context,
    scope: SettingsScope<any>,
    resolve: (session?: Session) => { container: string; profile: string },
): Array<() => void> {
    const disposers: Array<() => void> = [];

    // Static context (environment block + static profile) — head of the prompt.
    disposers.push(scopedCtx.systemPrompt.context({
        name: 'supermemory:environment',
        order: 5,
        text: (ctx) => {
            const session = ctx.agent?.session;
            if (!session || isSubagent(session)) return '';
            const { container, profile } = resolve(session);
            return staticContextText(superCtx, session, container, profile);
        },
    }));

    // Dynamic recall — right after the static context (order 6), so the
    // retrieved memories read immediately after the profile, before any of the
    // native sandbox/approval sections. Evaluated on every assembly; the text
    // provider only reads the cache the inbox handlers populate, so it is a
    // pure synchronous lookup (zero main-thread blocking). Config is resolved
    // live per assembly so settings edits surface immediately.
    disposers.push(scopedCtx.systemPrompt.context({
        name: 'supermemory:recall',
        order: 6,
        text: (ctx) => {
            const session = ctx.agent?.session;
            if (!session || isSubagent(session)) return '';
            return dynamicRecallText(session, recallConfigOf(scope));
        },
    }));

    return disposers;
}
