import { activeContainer, requireUpstream } from './config.js';
import { fetchProfile } from './containers.js';
import { turnTranscript } from './transcript.js';
import { ensureWslProbe } from './environment.js';
import { apiFetch } from './upstream.js';
import { registerMemoryContexts, clearRecallState, prewarmRecall, bindRecall, recallConfigOf } from './context-inject.js';
import { isSubagent } from './session-util.js';
// ---------------------------------------------------------------------------
// Session-scoped container snapshot
// ---------------------------------------------------------------------------
/**
 * Per-session container snapshot, taken at session/created and used by
 * turn/end persistence + context rendering — so injection and writes stay
 * bound to the SAME space even if the user switches the global setting
 * mid-session. Missing entry falls back to the live global setting.
 */
const sessionContainerRef = new Map();
/** Look up the container a session was bound to at creation time. */
export function getSessionContainer(sessionId) {
    return sessionContainerRef.get(sessionId);
}
/** Override the session container snapshot (used by the input-bar selector). */
export function setSessionContainer(sessionId, tag) {
    sessionContainerRef.set(sessionId, tag);
}
const sessionDocRef = new Map();
function sessionDocState(sessionId) {
    let entry = sessionDocRef.get(sessionId);
    if (!entry) {
        entry = { fullText: '', patching: false };
        sessionDocRef.set(sessionId, entry);
    }
    return entry;
}
/** Poll GET /v3/documents/{id} until status === "done" or the timeout elapses. */
async function waitDocumentDone(base, apiKey, docId, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const res = await fetch(base + '/v3/documents/' + encodeURIComponent(docId), {
                headers: { authorization: 'Bearer ' + apiKey },
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) {
                const data = (await res.json());
                if (data.status === 'done' || data.status === 'failed')
                    return;
            }
        }
        catch { /* transient — keep polling */ }
        if (Date.now() >= deadline)
            return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
}
// ---------------------------------------------------------------------------
// Turn persistence — one document per finished turn.
// ---------------------------------------------------------------------------
/**
 * Per-session workspace cache: a session cwd (and thus its workspace) never
 * changes, so resolve once and reuse. Shared by persistTurn (every turn) and
 * any future consumer; cleaned up on session/disposed.
 */
const sessionWorkspaceRef = new Map();
const workspaceResolving = new Set();
/** Resolve the workspace id owning a session (cached per session). */
async function workspaceOf(ctx, session) {
    if (sessionWorkspaceRef.has(session.id))
        return sessionWorkspaceRef.get(session.id);
    if (workspaceResolving.has(session.id))
        return undefined;
    workspaceResolving.add(session.id);
    try {
        const cwd = session.header?.cwd;
        const workspace = cwd ? await ctx.workspaceRegistry.resolveByPath(cwd) : undefined;
        const found = workspace ?? ctx.workspaceRegistry.list().find((w) => w.sessionIds.includes(session.id));
        const id = found ? String(found.id) : undefined;
        sessionWorkspaceRef.set(session.id, id);
        return id;
    }
    catch (error) {
        ctx.logger.warn('supermemory workspace resolve:', error);
        sessionWorkspaceRef.set(session.id, undefined);
        return undefined;
    }
    finally {
        workspaceResolving.delete(session.id);
    }
}
/**
 * Upsert the cumulative session transcript into one session-scoped document.
 *
 * First call for a session creates the document (POST); subsequent calls
 * PATCH the full cumulative text onto the same document, so the document
 * count stays O(sessions), not O(turns). While a PATCH is still processing
 * upstream this call bails early — the full text is already accumulated in
 * `sessionDocRef` and will be re-broadcast on the next turn, so no content is
 * lost even if an update is dropped.
 */
async function persistTurn(ctx, scope, session, turn, text) {
    const entry = sessionDocState(session.id);
    entry.fullText = entry.fullText
        ? entry.fullText + '\n\n' + text
        : text;
    // Serialize PATCHes: an update sent while the previous one is still
    // processing is ignored upstream, so never run two at once.
    if (entry.patching)
        return;
    entry.patching = true;
    try {
        const { base, apiKey } = requireUpstream(scope);
        const workspace = await workspaceOf(ctx, session);
        const containerTag = sessionContainerRef.get(session.id) ?? activeContainer(scope);
        const meta = {
            sessionId: session.id,
            lastTurn: turn,
            ...(workspace ? { workspace } : {}),
        };
        const signal = AbortSignal.timeout(30000);
        if (entry.docId) {
            // Update existing session document with the cumulative transcript.
            await apiFetch(base, apiKey, '/v3/documents/' + encodeURIComponent(entry.docId), {
                method: 'PATCH',
                body: {
                    content: entry.fullText,
                    taskType: 'memory',
                    documentDate: new Date().toISOString(),
                },
                signal,
            });
            await waitDocumentDone(base, apiKey, entry.docId);
        }
        else {
            // First turn: create the session document.
            const customId = session.id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 100);
            const created = await apiFetch(base, apiKey, '/v3/documents', {
                method: 'POST',
                body: {
                    content: entry.fullText,
                    containerTag,
                    customId,
                    taskType: 'memory',
                    dreaming: 'dynamic',
                    documentDate: new Date().toISOString(),
                    metadata: meta,
                },
                signal,
            });
            if (created.id) {
                entry.docId = created.id;
                ctx.logger.debug('supermemory session doc created id=' + created.id + ' session=' + session.id);
                await waitDocumentDone(base, apiKey, created.id);
            }
        }
    }
    catch (error) {
        ctx.logger.warn('supermemory turn persist:', error);
    }
    finally {
        entry.patching = false;
    }
}
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Injection orchestration
//
// The static context block and per-message dynamic recall are registered as
// systemPrompt.context() contributions (context-inject.ts) so they flow through
// the native assemble → project() step-level path. This module only decides the
// per-session state those text providers read synchronously: the container
// snapshot and the static profile cache.
// ---------------------------------------------------------------------------
/** Static-profile text per container (read by the context text provider).
 *  Pre-warmed at plugin activation (see prewarmProfile) so a brand-new session
 *  on the active container already has a stable profile on its first step —
 *  removing the old per-session async fetch that raced the first assembly.
 *  Entries carry a fetch timestamp so staleness can be refreshed (TTL in
 *  `PROFILE_TTL_MS`), instead of caching a container's profile forever. */
const PROFILE_TTL_MS = 5 * 60 * 1000;
const profileByContainer = new Map();
/** Containers with an in-flight profile fetch — serializes concurrent callers
 *  (e.g. an activation prewarm racing a session/created top-up for the same
 *  tag, which can otherwise fire duplicate fetches on a cold boot). */
const profileFetching = new Set();
/** Fetch (and cache) the profile for a container regardless of age. Returns the text, or ''. */
async function ingestProfile(scope, tag) {
    if (profileFetching.has(tag))
        return profileByContainer.get(tag)?.text ?? '';
    profileFetching.add(tag);
    try {
        const text = await fetchProfile(scope, tag);
        if (text)
            profileByContainer.set(tag, { text, at: Date.now() });
        return text;
    }
    catch {
        return '';
    }
    finally {
        profileFetching.delete(tag);
    }
}
/** Pre-warm the active container's static profile if missing or stale. */
export async function prewarmProfile(scope) {
    const tag = activeContainer(scope);
    const entry = profileByContainer.get(tag);
    if (entry && Date.now() - entry.at < PROFILE_TTL_MS)
        return;
    await ingestProfile(scope, tag);
}
/** Ensure the profile for `tag` is fresh (fill on miss/TTL-stale). */
async function ensureProfileFresh(scope, tag) {
    const entry = profileByContainer.get(tag);
    if (entry && Date.now() - entry.at < PROFILE_TTL_MS)
        return;
    await ingestProfile(scope, tag);
}
/** Resolve a session's active memory container (session snapshot \|\| global). */
function sessionContainerFor(session, scope) {
    return sessionContainerRef.get(session.id) ?? activeContainer(scope);
}
/** Register the session hooks (context registration + turn persistence). */
export function registerSessionHooks(ctx, scope) {
    const disposers = [];
    // Register the two context contributions through the native prompt channel.
    // `resolve` reads the per-container profile cache the activation prewarm + a
    // `session/created` fallback fill, plus the per-session container snapshot.
    ctx.inject(['systemPrompt'], (scopedCtx) => {
        disposers.push(...registerMemoryContexts(scopedCtx, ctx, scope, (session) => {
            const container = sessionContainerFor(session, scope);
            return {
                container,
                profile: profileByContainer.get(container)?.text ?? '',
            };
        }));
    });
    // ── Inbox-driven dynamic recall ────────────────────────────────────────
    //
    // The message body is available here (before assembly) via the native inbox
    // splice/claim notifications:
    //   - `agent/inbox/inserted` fires when a message enters a pending inbox
    //     list (as the user sends it). We synchronously search it and cache by
    //     signature — this deliberately pins the send path until the search
    //     lands ("make the agent busy until the search is done"), so the agent
    //     wakes with the cache warm.
    //   - `agent/inbox/claimed` fires right before the step's assembly. We bind
    //     the claimed message so the context text provider (dynamicRecallText)
    //     renders ITS recall by a pure cache read while assembling.
    // Both skip subagent sessions and non-user messages.
    disposers.push(ctx.on('agent/inbox/inserted', (payload) => {
        try {
            const p = payload;
            const session = p.agent?.session;
            if (!session || isSubagent(session))
                return;
            if (p.message?.source?.kind !== 'user')
                return;
            const cfg = recallConfigOf(scope);
            if (!cfg.recallEnabled)
                return;
            prewarmRecall(scope, session, sessionContainerFor(session, scope), cfg, p.message.content ?? []);
        }
        catch (error) {
            ctx.logger.warn('supermemory inbox prewarm:', error);
        }
    }));
    disposers.push(ctx.on('agent/inbox/claimed', (payload) => {
        try {
            const p = payload;
            const session = p.agent?.session;
            if (!session || isSubagent(session))
                return;
            if (p.message?.source?.kind !== 'user')
                return;
            const cfg = recallConfigOf(scope);
            if (!cfg.recallEnabled)
                return;
            bindRecall(scope, session, sessionContainerFor(session, scope), cfg, p.message.content ?? []);
        }
        catch (error) {
            ctx.logger.warn('supermemory inbox bind:', error);
        }
    }));
    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        sessionContainerRef.delete(session.id);
        sessionWorkspaceRef.delete(session.id);
        workspaceResolving.delete(session.id);
        sessionDocRef.delete(session.id);
        clearRecallState(session.id);
    }));
    // ── Session init: warm WSL probe + snapshot container. The static profile
    //    is pre-warmed at plugin activation (prewarmProfile); this fallback
    //    only tops up a container whose profile is uncached or stale (e.g. the
    //    user switched the global container after boot, or it aged past TTL).
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session))
            return;
        // Warm the WSL environment probe NOW (synchronously, before the first
        // model step renders the environment block) so the render path — which
        // is pure read — already has real shell/uv/os data. No-op for non-WSL.
        ensureWslProbe(session);
        void (async () => {
            try {
                const active = activeContainer(scope);
                if (!sessionContainerRef.has(session.id)) {
                    sessionContainerRef.set(session.id, active);
                }
                await ensureProfileFresh(scope, active);
                // Pre-init the session document state so the first turn's PATCH
                // logic has a stable entry (not strictly required, but keeps a
                // single ownership path for sessionDocRef).
                sessionDocState(session.id);
            }
            catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));
    // ── Turn persistence ──────────────────────────────────────────────────
    //
    // Recall is injected via the inbox + context providers above, not here.
    // This handler only persists the finished turn's transcript.
    disposers.push(ctx.on('session/event', (session, event) => {
        if (isSubagent(session))
            return;
        if (event.type === 'user/message') {
            return;
        }
        if (event.type !== 'turn/end')
            return;
        const turn = event.data.turn;
        const transcript = turnTranscript(session, turn);
        if (!transcript)
            return;
        void persistTurn(ctx, scope, session, turn, transcript);
    }));
    return disposers;
}
