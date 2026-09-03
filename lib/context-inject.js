import { execFileSync } from 'node:child_process';
import { requireUpstream, resolveConfig } from './config.js';
import { messageText } from './transcript.js';
import { environmentBlock } from './environment.js';
import { SearchWorker } from './search-worker.js';
import { recallSignature, renderRecall, filterSearchHits } from './recall.js';
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
export function staticContextText(ctx, session, container, profile) {
    const env = environmentBlock(ctx, session);
    const banner = profile
        ? '[Memory Context (from local supermemory)]\n\n' +
            'Active memory space: ' + container + '\n\n' +
            profile +
            '\n\n[SYSTEM INSTRUCTION] Memory queries default to the active memory space above.'
        : '';
    return [env, banner].filter((s) => s.length > 0).join('\n\n');
}
const recallCache = new Map();
function recallState(sessionId) {
    let state = recallCache.get(sessionId);
    if (!state) {
        state = { searched: new Set(), bySignature: new Map() };
        recallCache.set(sessionId, state);
    }
    return state;
}
/** Release per-session recall state (call from session/disposed). */
export function clearRecallState(sessionId) {
    recallCache.delete(sessionId);
}
function recallSearchSync(scope, container, query, limit, threshold) {
    try {
        const { base, apiKey } = requireUpstream(scope);
        try {
            return searchWorker.search(base, apiKey, query, container, limit, threshold);
        }
        catch {
            return recallSearchExec(base, apiKey, query, container, limit, threshold);
        }
    }
    catch { /* no key / upstream unreachable — silently skip recall */ }
    return [];
}
/** One-shot synchronous search via a temporary `node -e` subprocess (fallback). */
function recallSearchExec(base, apiKey, query, container, limit, threshold) {
    try {
        const script = '(async () => {\n' +
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
        const data = JSON.parse(out);
        return filterSearchHits(data.results ?? data.memories ?? [], threshold);
    }
    catch { /* upstream down / timeout — silently skip recall for this message */ }
    return [];
}
/**
 * Render the dynamic recall text for the current message, or '' when there is
 * nothing to inject. Looks up the latest real user message (source.kind===
 * "user") in the session's surface, dedups by signature, searches, and returns
 * the bounded hit list. Called synchronously by the context text provider.
 */
export function dynamicRecallText(scope, session, container, cfg) {
    if (!cfg.recallEnabled)
        return '';
    const lastUser = lastUserText(session);
    if (!lastUser)
        return '';
    const norm = recallSignature(lastUser);
    if (!norm)
        return '';
    const state = recallState(session.id);
    let hits = state.bySignature.get(norm);
    if (hits === undefined) {
        state.searched.add(norm);
        hits = recallSearchSync(scope, container, norm, cfg.recallTopK, cfg.recallThreshold);
        if (hits.length > 0)
            state.bySignature.set(norm, hits);
    }
    if (!hits || hits.length === 0)
        return '';
    return renderRecall(hits, cfg.recallTopK, cfg.recallMaxChars);
}
/** The most recent real user-message text in the session surface, or ''. */
function lastUserText(session) {
    try {
        return messageText(session.deriveMessages()
            .filter((m) => m.role === 'user' && m.source?.kind === 'user')
            .at(-1)?.content ?? []);
    }
    catch {
        return '';
    }
}
/**
 * Register the plugin's two context contributions through systemPrompt.context().
 * `resolve` supplies the per-session container + static profile (caller owns
 * those caches). Scope holds settings; `superCtx` is the plugin context for the
 * environment block. Returns the disposers.
 */
export function registerMemoryContexts(scopedCtx, superCtx, scope, resolve) {
    const cfg = resolveConfig(scope);
    const c = {
        recallEnabled: cfg.recallEnabled,
        recallTopK: cfg.recallTopK,
        recallMaxChars: cfg.recallMaxChars,
        recallThreshold: cfg.recallThreshold,
    };
    const disposers = [];
    // Static context (environment block + static profile) — head of the prompt.
    disposers.push(scopedCtx.systemPrompt.context({
        name: 'supermemory:environment',
        order: 5,
        text: (ctx) => {
            const session = ctx.agent?.session;
            if (!session || isSubagent(session))
                return '';
            const { container, profile } = resolve(session);
            return staticContextText(superCtx, session, container, profile);
        },
    }));
    // Dynamic recall — evaluated on every assembly, native-step timing.
    disposers.push(scopedCtx.systemPrompt.context({
        name: 'supermemory:recall',
        order: 210,
        text: (ctx) => {
            const session = ctx.agent?.session;
            if (!session || isSubagent(session))
                return '';
            const { container } = resolve(session);
            return dynamicRecallText(scope, session, container, c);
        },
    }));
    return disposers;
}
/** Skip subagent sessions for context contributions. */
function isSubagent(session) {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
