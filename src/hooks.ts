/**
 * Deterministic session hooks:
 *  - session/created -> snapshot the container + fetch profile into cache;
 *    the systemPrompt.context() registration reads the cache synchronously
 *    on every model step, so no agent.inject() is needed.
 *  - turn/end -> persist each finished turn as one supermemory document
 *    (low-value turns filtered out first). Subagent sessions are skipped
 *    for both hooks.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, requireUpstream } from './config.ts';
import { fetchProfile } from './containers.ts';
import { turnTranscript } from './transcript.ts';
import { isTurnLowValue } from './low-value.ts';
import { environmentBlock } from './environment.ts';

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
    const events = session.events;
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
// Turn persistence — one document per finished turn (low-value turns are
// filtered out before reaching this point).
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

/** Persist one finished turn as a supermemory document. */
async function persistTurn(
    ctx: Context,
    scope: SettingsScope<any>,
    session: Session,
    turn: number,
    text: string,
): Promise<void> {
    try {
        const { base, apiKey } = requireUpstream(scope);
        const customId = (session.id + '-turn-' + turn)
            .replace(/[^A-Za-z0-9_.-]/g, '-')
            .slice(0, 100);
        const workspace = await workspaceOf(ctx, session);
        const containerTag = sessionContainerRef.get(session.id) ?? activeContainer(scope);
        const res = await fetch(base + '/v3/documents', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
                content: text,
                containerTag,
                customId,
                taskType: 'memory',
                dreaming: 'dynamic',
                documentDate: new Date().toISOString(),
                metadata: {
                    sessionId: session.id,
                    turn: turn,
                    ...(workspace ? { workspace } : {}),
                },
            }),
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
            ctx.logger.warn(
                'supermemory turn persist: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200),
            );
        }
    }
    catch (error) {
        ctx.logger.warn('supermemory turn persist:', error);
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
    });

    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        sessionContainerRef.delete(session.id);
        sessionProfileCache.delete(session.id);
        sessionWorkspaceRef.delete(session.id);
        workspaceResolving.delete(session.id);
    }));

    // ── Session init: snapshot container + fetch profile into cache ─────
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session)) return;
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
            } catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));

    // ── Turn persistence ────────────────────────────────────────────────
    disposers.push(ctx.on('session/event', (session, event) => {
        if (isSubagent(session)) return;
        if (event.type !== 'turn/end') return;
        const turn = (event.data as { turn: number }).turn;
        const transcript = turnTranscript(session, turn);
        if (!transcript) return;
        if (isTurnLowValue(transcript)) return;
        void persistTurn(ctx, scope, session, turn, transcript);
    }));

    return disposers;
}
