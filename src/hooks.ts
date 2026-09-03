/**
 * Deterministic session hooks:
 *  - session/created -> snapshot the container + fetch profile into a cache
 *    the context text provider reads synchronously on the first model step.
 *  - systemPrompt.context() registrations (context-inject.ts) -> the static
 *    environment+profile block and the per-message dynamic recall both flow
 *    through the native assemble -> project() step-level path, so they land
 *    before the turn's first deriveMessages() and use native dedup timing.
 *  - turn/end -> accumulate the turn transcript and PATCH it into the
 *    session's single supermemory document (each session owns one doc).
 *    Subagent sessions are skipped for all of the above.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, requireUpstream } from './config.ts';
import { fetchProfile } from './containers.ts';
import { turnTranscript } from './transcript.ts';
import { ensureWslProbe } from './environment.ts';
import { apiFetch } from './upstream.ts';
import { registerMemoryContexts, clearRecallState } from './context-inject.ts';

// ---------------------------------------------------------------------------
// Session-scoped container snapshot
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
// Injection orchestration
//
// The static context block and per-message dynamic recall are registered as
// systemPrompt.context() contributions (context-inject.ts) so they flow through
// the native assemble → project() step-level path. This module only decides the
// per-session state those text providers read synchronously: the container
// snapshot and the static profile cache.
// ---------------------------------------------------------------------------

/** Cached static-profile text per session (read by the context text provider). */
const sessionProfileCache = new Map<string, string>();

/** Resolve a session's active memory container (session snapshot \|\| global). */
function sessionContainerFor(session: Session, scope: SettingsScope<any>): string {
    return sessionContainerRef.get(session.id) ?? activeContainer(scope);
}

/** Register the session hooks (context registration + turn persistence). */
export function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void> {
    const disposers: Array<() => void> = [];

    // Register the two context contributions through the native prompt channel.
    // `resolve` reads the per-session caches the session/created hook fills.
    ctx.inject(['systemPrompt'], (scopedCtx) => {
        disposers.push(...registerMemoryContexts(scopedCtx, ctx, scope, (session) => {
            return {
                container: sessionContainerFor(session!, scope),
                profile: session ? (sessionProfileCache.get(session.id) ?? '') : '',
            };
        }));
    });

    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        sessionContainerRef.delete(session.id);
        sessionProfileCache.delete(session.id);
        sessionWorkspaceRef.delete(session.id);
        workspaceResolving.delete(session.id);
        sessionDocRef.delete(session.id);
        clearRecallState(session.id);
    }));

    // ── Session init: warm WSL probe, snapshot container, fetch profile into
    //    the cache the context text provider reads synchronously on each step.
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session)) return;
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

    // ── Turn persistence + per-message dynamic recall logging ─────────────
    //
    // Dynamic recall is NOT appended here anymore — it is a context
    // contribution evaluated by the native step-level assembly, so it lands
    // before the first deriveMessages() of the turn. This handler only logs
    // the hit count for diagnostics and (on turn/end) persists the transcript.
    disposers.push(ctx.on('session/event', (session, event) => {
        if (isSubagent(session)) return;
        if (event.type === 'user/message') {
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
