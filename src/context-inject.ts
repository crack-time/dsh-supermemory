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

interface RecallConfig {
    recallTopK: number;
    recallMaxChars: number;
    recallThreshold: number;
    recallEnabled: boolean;
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
 * Render the dynamic recall text for the current message, or '' when there is
 * nothing to inject. Looks up the latest real user message (source.kind===
 * "user") in the session's surface, dedups by signature, searches, and returns
 * the bounded hit list. Called synchronously by the context text provider.
 */
export function dynamicRecallText(
    scope: SettingsScope<any>,
    session: Session,
    container: string,
    cfg: RecallConfig,
): string {
    if (!cfg.recallEnabled) return '';
    const lastUser = lastUserText(session);
    if (!lastUser) return '';
    const norm = recallSignature(lastUser);
    if (!norm) return '';
    const state = recallState(session.id);
    let hits: Array<{ memory: string }> | undefined = state.bySignature.get(norm);
    if (hits === undefined) {
        state.searched.add(norm);
        hits = recallSearchSync(scope, container, norm, cfg.recallTopK, cfg.recallThreshold);
        if (hits.length > 0) state.bySignature.set(norm, hits);
    }
    if (!hits || hits.length === 0) return '';
    return renderRecall(hits, cfg.recallTopK, cfg.recallMaxChars);
}

/** The most recent real user-message text in the session surface, or ''. */
function lastUserText(session: Session): string {
    try {
        return messageText(session.deriveMessages()
            .filter((m) => m.role === 'user' && m.source?.kind === 'user')
            .at(-1)?.content ?? []);
    } catch {
        return '';
    }
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
    const cfg = resolveConfig(scope);
    const c: RecallConfig = {
        recallEnabled: cfg.recallEnabled,
        recallTopK: cfg.recallTopK,
        recallMaxChars: cfg.recallMaxChars,
        recallThreshold: cfg.recallThreshold,
    };
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
    // native sandbox/approval sections. Evaluated on every assembly.
    disposers.push(scopedCtx.systemPrompt.context({
        name: 'supermemory:recall',
        order: 6,
        text: (ctx) => {
            const session = ctx.agent?.session;
            if (!session || isSubagent(session)) return '';
            const { container } = resolve(session);
            return dynamicRecallText(scope, session, container, c);
        },
    }));

    return disposers;
}

/** Skip subagent sessions for context contributions. */
function isSubagent(session: Session): boolean {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
