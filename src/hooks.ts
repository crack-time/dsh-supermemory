/**
 * Deterministic session hooks:
 *  - activation -> pre-warm the active container's static profile into a global
 *    cache (see prewarmProfile); a session/created fallback tops up a container
 *    that changed after boot. The context text provider reads this cache
 *    synchronously on the first model step.
 *  - agent/inbox/inserted|claimed -> drive per-message dynamic recall: prewarm
 *    the search at insert (pinning the send path until it lands) and bind the
 *    claimed message so the context text provider renders its recall from cache.
 *  - systemPrompt.context() registrations (context-inject.ts) -> static
 *    environment+profile and per-message recall flow through the native
 *    assemble → project() step-level path.
 *  - domain/changed (workspace registry) -> archive-time persistence: when a
 *    session enters the registry's archivedSessionIds, recompute its FULL
 *    transcript from the persistence-backed event history (live or cold) and
 *    upsert it into supermemory (idempotent PATCH overwrite). This replaces the
 *    old per-turn write that re-ingested the transcript (and re-ran the
 *    upstream LLM filter) on every turn. Subagent sessions are skipped.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { activeContainer, requireUpstream } from './config.ts';
import { fetchProfile } from './containers.ts';
import { sessionTranscript } from './transcript.ts';
import { ensureWslProbe } from './environment.ts';
import { apiFetch, listDocumentPages } from './upstream.ts';
import { registerMemoryContexts, clearRecallState, prewarmRecall, bindRecall, recallConfigOf } from './context-inject.ts';
import { isSubagent } from './session-util.ts';

// ---------------------------------------------------------------------------
// Session-scoped container snapshot
// ---------------------------------------------------------------------------

/**
 * Per-session container snapshot, taken at session/created and used by
 * archive-time persistence + context rendering — so injection and writes stay
 * bound to the SAME space even if the user switches the global setting
 * mid-session. Missing entry falls back to the live global setting.
 *
 * Persisted to disk (~/.dsh/supermemory/session-containers.json) so a resumed
 * session remembers the space chosen in the input-bar selector across restarts
 * instead of defaulting to the global activeContainer.
 */
/** The persistent per-session container store location. */
export const SESSION_CONTAINER_FILE = join(homedir(), '.dsh', 'supermemory', 'session-containers.json');

/** How often the per-session container map is swept for stale (deleted) sessions. */
export const SESSION_CONTAINER_GC_INTERVAL_MS = 10 * 60 * 1000;

/** Load the per-session container map from disk (on module load). */
function loadSessionContainers(): Map<string, string> {
    const map = new Map<string, string>();
    try {
        const raw = readFileSync(SESSION_CONTAINER_FILE, 'utf8');
        const obj = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.trim()) map.set(k, v.trim());
        }
    }
    catch { /* no file yet — first run */ }
    return map;
}

const sessionContainerRef = loadSessionContainers();

/** Persist the session/container map so a session keeps its space across restarts. */
export function persistSessionContainers(): void {
    try {
        mkdirSync(dirname(SESSION_CONTAINER_FILE), { recursive: true });
        writeFileSync(SESSION_CONTAINER_FILE, JSON.stringify(Object.fromEntries(sessionContainerRef), null, 2));
    }
    catch { /* non-fatal: a missed cache write just falls back to the global tag */ }
}

/** Look up the container a session was bound to at creation time. */
export function getSessionContainer(sessionId: string): string | undefined {
    return sessionContainerRef.get(sessionId);
}

/** Override the session container snapshot (used by the input-bar selector). */
export function setSessionContainer(sessionId: string, tag: string): void {
    sessionContainerRef.set(sessionId, tag);
    persistSessionContainers();
}

/**
 * Collect every session id that currently exists on disk under the DSH sessions
 * root (`~/.dsh/sessions/<workspace>/<session-id>/`). A deleted DSH session has
 * its log directory removed, so this is a reliable "does this session still
 * exist?" signal for pruning stale per-session container bindings.
 */
export function existingSessionIds(): Set<string> {
    const found = new Set<string>();
    const root = join(homedir(), '.dsh', 'sessions');
    let workspaces: string[];
    try {
        workspaces = readdirSync(root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
    catch { return found; }
    for (const ws of workspaces) {
        let names: string[];
        try {
            names = readdirSync(join(root, ws), { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
        }
        catch { continue; }
        for (const name of names) {
            if (name.startsWith('session-')) found.add(name);
        }
    }
    return found;
}

/**
 * Drop per-session container entries for sessions that no longer exist (their
 * DSH log dir is gone). Keeps entries that are still live even if the log isn't
 * flushed to disk yet. Persists only when something was removed. Returns how
 * many stale bindings were pruned.
 */
export function pruneStaleSessionContainers(liveIds?: Iterable<string>): number {
    const existing = existingSessionIds();
    if (liveIds) for (const id of liveIds) existing.add(id);
    let removed = 0;
    for (const key of [...sessionContainerRef.keys()]) {
        if (!existing.has(key)) {
            sessionContainerRef.delete(key);
            removed += 1;
        }
    }
    if (removed > 0) persistSessionContainers();
    return removed;
}

/**
 * Sessions we have already run archive-time persistence for (since boot).
 * Guards a single domain/changed batch from re-entering the write for a session
 * that appears multiple times in one `archivedSessionIds` update. Purely
 * in-memory re-entry lock — NOT durability: re-archives after a restart are
 * still handled (PATCH-overwrite via metadata.sessionId) and non-archived
 * sessions are never logged here.
 */
const archivedBySession = new Set<string>();

// ---------------------------------------------------------------------------
// Archive-time session persistence
//
// The session's FULL transcript is written to supermemory exactly once, when
// the session is archived (workspace "archive session" action). This replaces
// the old per-turn PATCH-on-every-turn scheme, which re-ingested (and re-ran
// the upstream LLM filter, `shouldLLMFilter`) on every finished turn. The
// write is idempotent against the session's persistence-backed event history
// (never the in-memory accumulator): on archive we read the session's complete
// events — live, or via sessionPersistence.load() when cold — recompute the
// full transcript, and PATCH-overwrite the existing session document if one
// exists (found by its `metadata.sessionId`), else POST a new one.
// ---------------------------------------------------------------------------

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
 * Per-session workspace cache: a session cwd (and thus its workspace) never
 * changes, so resolve once and reuse. Shared by archive-time persistence and
 * cleaned up on session/disposed.
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
 * Resolve a session's full event history, live-first then from persistence.
 * Returns a shape exposing `snapshotEvents()` (a minimal Session facade) so
 * the transcript composer can scan it — matches Session's surface, but cold
 * sessions are built from their persisted inspection.
 */
/** Minimal event-source facade: the transcript composer only needs the id and a
 *  snapshotEvents() that returns the session's event history (live or cold). */
interface TranscriptSource {
    id: string;
    snapshotEvents: () => readonly unknown[];
}

async function sessionEventsOf(
    ctx: Context,
    sessionId: string,
): Promise<TranscriptSource | undefined> {
    // Branded SessionId is enforced only at API boundaries; here we hold the
    // raw string id from the workspace registry, so cast at the call site.
    const sid = sessionId as unknown as Parameters<Context['sessions']['get']>[0];
    const live = ctx.sessions?.get(sid);
    if (live) return { id: sessionId, snapshotEvents: live.snapshotEvents.bind(live) };
    const persistence = ctx.sessionPersistence;
    if (!persistence) return undefined;
    try {
        const inspection = await persistence.load(sid);
        const events = inspection.events as readonly unknown[];
        return { id: sessionId, snapshotEvents: () => events };
    }
    catch {
        return undefined;
    }
}

/**
 * Find an existing supermemory document for this session by its
 * `metadata.sessionId`, so re-archive PATCHes-overwrites instead of duplicating.
 */
async function findSessionDocument(
    base: string,
    apiKey: string,
    sessionId: string,
): Promise<string | undefined> {
    let found: string | undefined;
    await listDocumentPages(base, apiKey, { limit: 200, maxPages: 20 }, (docs) => {
        if (found) return;
        for (const d of docs) {
            if (d.metadata?.sessionId !== sessionId) continue;
            found = d.id;
            return;
        }
    });
    return found;
}

/**
 * Idempotently persist a session's FULL transcript on archive.
 *
 * In-memory accumulator absent by design: the transcript is recomputed from the
 * session's persistence-backed event history (live or cold), so a warm restart
 * never loses content. Existing document (matched by metadata.sessionId) is
 * PATCH-overwritten with the fresh transcript; otherwise a new document is
 * POST-created with `customId = session.id`.
 */
async function persistSessionAtArchive(
    ctx: Context,
    scope: SettingsScope<any>,
    sessionId: string,
): Promise<void> {
    const source = await sessionEventsOf(ctx, sessionId);
    if (!source) {
        ctx.logger.warn('supermemory archive: no event source for session ' + sessionId);
        return;
    }
    // The transcript composer needs only id + snapshotEvents(); workspaceOf
    // reads the (optional) cwd header. Live sessions carry their header; cold
    // sessions have none, which just leaves workspace undefined.
    const fake = { id: sessionId, snapshotEvents: source.snapshotEvents } as Session;
    const text = sessionTranscript(fake);
    if (!text) {
        ctx.logger.warn('supermemory archive: empty transcript for session ' + sessionId);
        return;
    }
    const { base, apiKey } = requireUpstream(scope);
    const containerTag = sessionContainerRef.get(sessionId) ?? activeContainer(scope);
    const workspace = await workspaceOf(ctx, fake);
    const meta: Record<string, unknown> = {
        sessionId,
        archivedAt: new Date().toISOString(),
        ...(workspace ? { workspace } : {}),
    };
    const signal = AbortSignal.timeout(30000);

    const docId = await findSessionDocument(base, apiKey, sessionId);
    if (docId) {
        // Re-archive / already exists: overwrite the cumulative transcript.
        await apiFetch(base, apiKey, '/v3/documents/' + encodeURIComponent(docId), {
            method: 'PATCH',
            body: {
                content: text,
                taskType: 'memory',
                documentDate: new Date().toISOString(),
            },
            signal,
        });
        await waitDocumentDone(base, apiKey, docId);
        ctx.logger.debug('supermemory archive: PATCH updated session doc id=' + docId + ' session=' + sessionId);
        return;
    }
    // First archive: create the session document.
    const customId = sessionId.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 100);
    const created = await apiFetch<{ id?: string; status?: string }>(
        base,
        apiKey,
        '/v3/documents',
        {
            method: 'POST',
            body: {
                content: text,
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
        ctx.logger.debug('supermemory archive: session doc created id=' + created.id + ' session=' + sessionId);
        await waitDocumentDone(base, apiKey, created.id);
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
const profileByContainer = new Map<string, { text: string; at: number }>();
/** Containers with an in-flight profile fetch — serializes concurrent callers
 *  (e.g. an activation prewarm racing a session/created top-up for the same
 *  tag, which can otherwise fire duplicate fetches on a cold boot). */
const profileFetching = new Set<string>();

/** Fetch (and cache) the profile for a container regardless of age. Returns the text, or ''. */
async function ingestProfile(scope: SettingsScope<any>, tag: string): Promise<string> {
    if (profileFetching.has(tag)) return profileByContainer.get(tag)?.text ?? '';
    profileFetching.add(tag);
    try {
        const text = await fetchProfile(scope, tag);
        if (text) profileByContainer.set(tag, { text, at: Date.now() });
        return text;
    } catch {
        return '';
    } finally {
        profileFetching.delete(tag);
    }
}

/** Pre-warm the active container's static profile if missing or stale. */
export async function prewarmProfile(scope: SettingsScope<any>): Promise<void> {
    const tag = activeContainer(scope);
    const entry = profileByContainer.get(tag);
    if (entry && Date.now() - entry.at < PROFILE_TTL_MS) return;
    await ingestProfile(scope, tag);
}

/** Ensure the profile for `tag` is fresh (fill on miss/TTL-stale). */
async function ensureProfileFresh(scope: SettingsScope<any>, tag: string): Promise<void> {
    const entry = profileByContainer.get(tag);
    if (entry && Date.now() - entry.at < PROFILE_TTL_MS) return;
    await ingestProfile(scope, tag);
}

/** Resolve a session's active memory container (session snapshot \|\| global). */
function sessionContainerFor(session: Session, scope: SettingsScope<any>): string {
    return sessionContainerRef.get(session.id) ?? activeContainer(scope);
}

/** Register the session hooks (context registration + turn persistence). */
export function registerSessionHooks(ctx: Context, scope: SettingsScope<any>): Array<() => void> {
    const disposers: Array<() => void> = [];

    // Register the two context contributions through the native prompt channel.
    // `resolve` reads the per-container profile cache the activation prewarm + a
    // `session/created` fallback fill, plus the per-session container snapshot.
    ctx.inject(['systemPrompt'], (scopedCtx) => {
        disposers.push(...registerMemoryContexts(scopedCtx, ctx, scope, (session) => {
            const container = sessionContainerFor(session!, scope);
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
            const p = payload as { agent?: { session?: Session }; message?: { source?: { kind?: string }; content?: readonly unknown[] } };
            const session = p.agent?.session;
            if (!session || isSubagent(session)) return;
            if (p.message?.source?.kind !== 'user') return;
            const cfg = recallConfigOf(scope);
            if (!cfg.recallEnabled) return;
            prewarmRecall(scope, session, sessionContainerFor(session, scope), cfg, p.message.content ?? []);
        }
        catch (error) { ctx.logger.warn('supermemory inbox prewarm:', error); }
    }));
    disposers.push(ctx.on('agent/inbox/claimed', (payload) => {
        try {
            const p = payload as { agent?: { session?: Session }; message?: { source?: { kind?: string }; content?: readonly unknown[] } };
            const session = p.agent?.session;
            if (!session || isSubagent(session)) return;
            if (p.message?.source?.kind !== 'user') return;
            const cfg = recallConfigOf(scope);
            if (!cfg.recallEnabled) return;
            bindRecall(scope, session, sessionContainerFor(session, scope), cfg, p.message.content ?? []);
        }
        catch (error) { ctx.logger.warn('supermemory inbox bind:', error); }
    }));

    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        sessionContainerRef.delete(session.id);
        sessionWorkspaceRef.delete(session.id);
        workspaceResolving.delete(session.id);
        archivedBySession.delete(session.id);
        clearRecallState(session.id);
    }));

    // ── Session init: warm WSL probe + snapshot container. The static profile
    //    is pre-warmed at plugin activation (prewarmProfile); this fallback
    //    only tops up a container whose profile is uncached or stale (e.g. the
    //    user switched the global container after boot, or it aged past TTL).
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
                await ensureProfileFresh(scope, active);
            } catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));

    // ── Archive-time persistence ──────────────────────────────────────────
    //
    // The native "archive session" action (workspace three-dot menu) writes to
    // the workspace registry's archivedSessionIds, which the workspace domain
    // publishes as a domain/changed update with table "" and a value carrying
    // archivedSessionIds. When a session enters that set we persist its FULL
    // transcript to supermemory — once per session per boot (archivedBySession
    // guards the re-entry), idempotently PATCHing any prior document.
    disposers.push(ctx.on('domain/changed', (change) => {
        try {
            const c = change as {
                domain?: string;
                table?: string;
                operation?: string;
                value?: { archivedSessionIds?: readonly unknown[] };
            };
            if (c.domain !== 'workspace') return;
            if (c.table !== '' || c.operation !== 'put') return;
            const archived = c.value?.archivedSessionIds ?? [];
            if (archived.length === 0) return;
            for (const raw of archived) {
                const sessionId = typeof raw === 'string' ? raw : '';
                if (!sessionId) continue;
                if (archivedBySession.has(sessionId)) continue;
                archivedBySession.add(sessionId);
                void persistSessionAtArchive(ctx, scope, sessionId);
            }
        }
        catch (error) { ctx.logger.warn('supermemory archive hook:', error); }
    }));

    // ── Per-session container GC ──────────────────────────────────────────
    // Prune stale bindings so session-containers.json does not grow forever as
    // sessions are deleted. Runs once at activation and then on a slow timer;
    // a key survives if the session is live in memory OR still has a log dir.
    const gcStale = (): void => {
        try {
            const live = ctx.sessions?.list?.() ? ctx.sessions.list().map((s) => s.id) : [];
            const removed = pruneStaleSessionContainers(live);
            if (removed > 0) ctx.logger.debug('supermemory session-container GC: pruned ' + removed + ' stale entries');
        }
        catch (error) { ctx.logger.warn('supermemory session-container GC:', error); }
    };
    gcStale();
    const gcTimer = setInterval(gcStale, SESSION_CONTAINER_GC_INTERVAL_MS);
    disposers.push(() => clearInterval(gcTimer));

    return disposers;
}
