import { execFileSync } from 'node:child_process';
import { requireUpstream, resolveConfig } from './config.js';
import { messageText } from './transcript.js';
import { environmentBlock } from './environment.js';
import { SearchWorker } from './search-worker.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { recallSignature, renderRecall, filterSearchHits } from './recall.js';
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
export function contextMessageText(ctx, session, container, profile) {
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
function appendContextMessage(session, text) {
    if (!text)
        return;
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
export function injectStaticContext(ctx, session, container, profile) {
    appendContextMessage(session, contextMessageText(ctx, session, container, profile));
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
function recallSearchSync(scope, container, query, limit) {
    try {
        const { base, apiKey } = requireUpstream(scope);
        const threshold = resolveConfig(scope).recallThreshold;
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
 * Hook a real user message: normalize + dedup, then SYNCHRONOUSLY search into
 * cache and append the rendered recall (labelled context row). Returns the
 * number of hits injected (so the caller can log it). The injected message's
 * own `user/message` event is skipped by the caller (source is not "user"), so
 * this cannot recurse.
 *
 * `resolveContainer` maps a session to its active memory container (the caller
 * keeps the per-session snapshot; this module stays container-agnostic).
 */
export function injectDynamicRecall(scope, session, event, resolveContainer) {
    const e = event;
    if (e.data?.source?.kind !== 'user')
        return 0;
    const text = messageText(e.data.content ?? []);
    const norm = recallSignature(text);
    if (!norm)
        return 0;
    const cfg = resolveConfig(scope);
    if (!cfg.recallEnabled)
        return 0;
    const state = recallState(session.id);
    let hits;
    if (state.searched.has(norm)) {
        hits = state.bySignature.get(norm) ?? [];
    }
    else {
        state.searched.add(norm);
        hits = recallSearchSync(scope, resolveContainer(session), norm, cfg.recallTopK);
        if (hits.length > 0)
            state.bySignature.set(norm, hits);
    }
    if (hits.length === 0)
        return 0;
    const rendered = renderRecall(hits, cfg.recallTopK, cfg.recallMaxChars);
    if (!rendered)
        return 0;
    appendContextMessage(session, rendered);
    return hits.length;
}
