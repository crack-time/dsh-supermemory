/**
 * Deterministic session hooks:
 *  - session/created -> snapshot the container + fetch profile into cache;
 *    the systemPrompt.context() registration reads the cache synchronously
 *    on every model step, so no agent.inject() is needed.
 *  - user/message -> per-message dynamic recall: dedupe + synchronously search
 *    the message (so the cache is guaranteed populated before prompt assembly)
 *    and cache hits; the `supermemory:recall-dynamic` section injects them
 *    (bounded, marked untrusted) right after the static profile.
 *  - turn/end -> accumulate the turn transcript and PATCH it into the
 *    session's single supermemory document (each session owns one doc).
 *    Subagent sessions are skipped for all of the above.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { execFileSync } from 'node:child_process';
import { activeContainer, requireUpstream, resolveConfig } from './config.ts';
import { fetchProfile } from './containers.ts';
import { messageText, turnTranscript } from './transcript.ts';
import { environmentBlock, ensureWslProbe } from './environment.ts';
import { SearchWorker } from './search-worker.ts';
import { apiFetch } from './upstream.ts';
import { recallSignature, renderRecall, filterSearchHits } from './recall.ts';

/** One persistent search worker shared by every session (spawned on first use). */
const searchWorker = new SearchWorker();

// ---------------------------------------------------------------------------
// Context injection via systemPrompt.context()
// ---------------------------------------------------------------------------

/**
 * Per-session container snapshot, taken at session/created and used by
 * turn/end persistence + context rendering — so injection and writes stay
 * bound to the SAME space even if the user switches the global setting
 * mid-session. Missing entry falls back to the live global setting.
 */
const sessionContainerRef = new Map<string, string>();

/** Look up the container a session was bound to at creation time. */
export function getSessionContainer(sessionId: string): string | undefined {
    return sessionContainerRef.get(sessionId);
}

/** Override the session container snapshot (used by the input-bar selector). */
export function setSessionContainer(sessionId: string, tag: string): void {
    sessionContainerRef.set(sessionId, tag);
}

// ---------------------------------------------------------------------------
// Session-scoped document persistence
//
// One document per session, updated (PATCH) with the cumulative transcript on
// every turn — instead of the old turn-per-document scheme that grew the
// document count linearly with turns. Kept in-memory so the cumulative text
// survives a miss and the "patching" flag serializes PATCHes (a PATCH issued
// while a previous one is still processing is dropped upstream, so we never
// run two at once; the full text is re-broadcast next time).
// ---------------------------------------------------------------------------

export interface SessionDocState {
    /** Upstream document id for this session, once created. */
    docId?: string;
    /** Cumulative transcript text since session creation. */
    fullText: string;
    /** True while a PATCH is in flight — skip new turns until it settles. */
    patching: boolean;
}

const sessionDocRef = new Map<string, SessionDocState>();

function sessionDocState(sessionId: string): SessionDocState {
    let entry = sessionDocRef.get(sessionId);
    if (!entry) {
        entry = { fullText: '', patching: false };
        sessionDocRef.set(sessionId, entry);
    }
    return entry;
}

/** Poll GET /v3/documents/{id} until status === "done" or the timeout elapses. */
async function waitDocumentDone(
    base: string,
    apiKey: string,
    docId: string,
    timeoutMs = 90000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const res = await fetch(base + '/v3/documents/' + encodeURIComponent(docId), {
                headers: { authorization: 'Bearer ' + apiKey },
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) {
                const data = (await res.json()) as { status?: string };
                if (data.status === 'done' || data.status === 'failed') return;
            }
        }
        catch { /* transient — keep polling */ }
        if (Date.now() >= deadline) return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
}

/**
 * Cached profile text per session, populated asynchronously in session/created
 * and read synchronously by the systemPrompt.context() text function.
 */
const sessionProfileCache = new Map<string, string>();

/**
 * Scan session events for an existing supermemory injection (survives host
 * restart / compaction). Returns the container tag embedded in the injection
 * text, or undefined if no prior injection exists.
 *
 * Forward scan is correct here: injection events are at the start of the
 * event log (first few events after session creation).
 */
function recoverInjectedContainer(session: Session): string | undefined {
    const events = session.snapshotEvents();
    for (let i = 0; i < events.length; i += 1) {
        const e = events[i];
        if (!e) continue;
        if ((e.type as string) !== 'agent/inbox/spliced') continue;
        const inserted = (e.data as { inserted?: Array<{ source?: { plugin?: string }; content?: readonly unknown[] }> }).inserted;
        if (!Array.isArray(inserted)) continue;
        for (const msg of inserted) {
            if (msg.source?.plugin !== '@crack/dsh-supermemory') continue;
            const blocks = msg.content ?? [];
            for (const block of blocks) {
                const b = block as { type?: string; text?: string };
                if (typeof b.text === 'string') {
                    const match = b.text.match(/Active memory space: (\S+)/);
                    if (match) return match[1];
                }
            }
            return undefined;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Turn persistence — one document per finished turn.
// ---------------------------------------------------------------------------

/**
 * Per-session workspace cache: a session cwd (and thus its workspace) never
 * changes, so resolve once and reuse. Shared by persistTurn (every turn) and
 * any future consumer; cleaned up on session/disposed.
 */
const sessionWorkspaceRef = new Map<string, string | undefined>();
const workspaceResolving = new Set<string>();

/** Resolve the workspace id owning a session (cached per session). */
async function workspaceOf(ctx: Context, session: Session): Promise<string | undefined> {
    if (sessionWorkspaceRef.has(session.id)) return sessionWorkspaceRef.get(session.id);
    if (workspaceResolving.has(session.id)) return undefined;
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
async function persistTurn(
    ctx: Context,
    scope: SettingsScope<any>,
    session: Session,
    turn: number,
    text: string,
): Promise<void> {
    const entry = sessionDocState(session.id);
    entry.fullText = entry.fullText
        ? entry.fullText + '\n\n' + text
        : text;

    // Serialize PATCHes: an update sent while the previous one is still
    // processing is ignored upstream, so never run two at once.
    if (entry.patching) return;
    entry.patching = true;
    try {
        const { base, apiKey } = requireUpstream(scope);
        const workspace = await workspaceOf(ctx, session);
        const containerTag = sessionContainerRef.get(session.id) ?? activeContainer(scope);
        const meta: Record<string, unknown> = {
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
            const created = await apiFetch<{ id?: string; status?: string }>(
                base,
                apiKey,
                '/v3/documents',
                {
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
                },
            );
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

/** Skip subagent sessions for both hooks. */
function isSubagent(session: Session): boolean {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Per-message dynamic recall
//
// The static profile section (`supermemory:recall`, order 200) is fetched once
// at session/created — it answers "who is this user". Dynamic recall is the
// per-message complement: on every real user message we run a semantic search
// and cache the hits (deduped + bounded), and the `supermemory:recall-dynamic`
// section (order 210) injects them right after the profile. The render path is
// a pure read of the cache — it never blocks on the upstream.
// ---------------------------------------------------------------------------

interface RecallState {
    /** Normalized user-message texts already searched this session (dedup). */
    searched: Set<string>;
    /** Search hits keyed by the normalized message text. */
    bySignature: Map<string, Array<{ memory: string }>>;
    /** The CURRENT user message + its hits, set in the user/message handler.
     *  The render path reads this directly instead of scanning the event log,
     *  so it works even if the message isn't committed to events yet. */
    current?: { signature: string; hits: Array<{ memory: string }> };
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

/**
 * Deterministic sync search over the active container.
 *
 * cordis `ctx.emit()` dispatches handlers synchronously and does NOT await
 * their returned promises, so an async search in a `user/message` handler can't
 * be guaranteed to have landed before the system prompt is assembled. To make
 * the injected recall deterministic we run the search SYNCHRONOUSLY here (via a
 * tiny inline `node -e` subprocess that performs the local HTTP call), so the
 * cache is populated before `emit` returns — and before assembly reads it.
 * Bounded by a hard timeout; never throws.
 */
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

/** Hook a real user message: normalize, dedup, then SYNCHRONOUSLY search into cache. */
/** Hook a real user message: normalize, dedup, then SYNCHRONOUSLY search into cache.
 *  Returns the hits (so the caller can log them). */
function kickRecallSearch(scope: SettingsScope<any>, session: Session, event: unknown): Array<{ memory: string }> {
    const hits: Array<{ memory: string }> = [];
    const e = event as { type?: string; data?: { source?: { kind?: string }; content?: readonly unknown[] } };
    if (e.data?.source?.kind !== 'user') return hits;
    const text = messageText(e.data.content ?? []);
    const norm = recallSignature(text);
    if (!norm) return hits;
    const cfg = resolveConfig(scope);
    if (!cfg.recallEnabled) return hits;
    const state = recallState(session.id);
    if (state.searched.has(norm)) {
        state.current = { signature: norm, hits: state.bySignature.get(norm) ?? [] };
        return state.current.hits;
    }
    state.searched.add(norm);
    const container = sessionContainerRef.get(session.id) ?? activeContainer(scope);
    const found = recallSearchSync(scope, container, norm, cfg.recallTopK);
    state.current = { signature: norm, hits: found };
    if (found.length > 0) state.bySignature.set(norm, found);
    return found;
}

/** Render the cached hits for the current message — pure read, bounded, marked untrusted. */
function recallDynamicText(scope: SettingsScope<any>, session: Session): string {
    const state = recallCache.get(session.id);
    if (!state?.current || state.current.hits.length === 0) return '';
    const cfg = resolveConfig(scope);
    return renderRecall(state.current.hits, cfg.recallTopK, cfg.recallMaxChars);
}

/** Register the systemPrompt.context() + session hooks. */
export function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void> {
    const disposers: Array<() => void> = [];

    // ── Dynamic context via systemPrompt ────────────────────────────────
    ctx.inject(['systemPrompt'], (scopedCtx) => {
        // Dynamic environment block — first context the model reads (order 5).
        disposers.push(scopedCtx.systemPrompt.context({
            name: 'supermemory:environment',
            order: 5,
            text: (context: { agent?: { session?: Session } }) => {
                const session = context.agent?.session;
                if (!session || isSubagent(session)) return '';
                return environmentBlock(ctx, session);
            },
        }));
        disposers.push(scopedCtx.systemPrompt.context({
            name: 'supermemory:recall',
            order: 200,
            text: (context: { agent?: { session?: Session } }) => {
                const session = context.agent?.session;
                if (!session || isSubagent(session)) return '';
                const container = sessionContainerRef.get(session.id) ?? activeContainer(scope);
                const profile = sessionProfileCache.get(session.id);
                if (!profile) return '';
                return '[Memory Context (from local supermemory)]\n\n' +
                    'Active memory space: ' + container + '\n\n' +
                    profile +
                    '\n\n[SYSTEM INSTRUCTION] Memory queries default to the active memory space above.';
            },
        }));
        disposers.push(scopedCtx.systemPrompt.context({
            name: 'supermemory:recall-dynamic',
            order: 210,
            text: (context: { agent?: { session?: Session } }) => {
                const session = context.agent?.session;
                if (!session || isSubagent(session)) return '';
                return recallDynamicText(scope, session);
            },
        }));
    });

    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        sessionContainerRef.delete(session.id);
        sessionProfileCache.delete(session.id);
        sessionWorkspaceRef.delete(session.id);
        workspaceResolving.delete(session.id);
        sessionDocRef.delete(session.id);
        recallCache.delete(session.id);
    }));

    // ── Session init: warm WSL probe, snapshot container, fetch profile ──
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session)) return;
        // Warm the WSL environment probe NOW (synchronously, before the first
        // model step renders the environment block) so the render path — which
        // is pure read — already has real shell/uv/os data. No-op for non-WSL.
        ensureWslProbe(session);
        void (async () => {
            try {
                const recovered = recoverInjectedContainer(session);
                const active = recovered ?? activeContainer(scope);
                if (recovered) {
                    ctx.logger.debug('supermemory: recovered container "' + recovered + '" for session ' + session.id);
                }
                if (!sessionContainerRef.has(session.id)) {
                    sessionContainerRef.set(session.id, active);
                }
                let profileText = '';
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    try {
                        profileText = await fetchProfile(scope, active);
                        if (profileText) break;
                    }
                    catch { /* upstream may still be booting */ }
                    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                }
                if (profileText) {
                    sessionProfileCache.set(session.id, profileText);
                }
                // Pre-init the session document state so the first turn's PATCH
                // logic has a stable entry (not strictly required, but keeps a
                // single ownership path for sessionDocRef).
                sessionDocState(session.id);
            } catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));

    // ── Turn persistence + per-message dynamic recall ─────────────────────
    disposers.push(ctx.on('session/event', (session, event) => {
        if (isSubagent(session)) return;
        if (event.type === 'user/message') {
            const hits = kickRecallSearch(scope, session, event);
            ctx.logger.debug(`[supermemory:recall] session=${session.id} hits=${hits.length}`);
            return;
        }
        if (event.type !== 'turn/end') return;
        const turn = (event.data as { turn: number }).turn;
        const transcript = turnTranscript(session, turn);
        if (!transcript) return;
        void persistTurn(ctx, scope, session, turn, transcript);
    }));

    return disposers;
}
