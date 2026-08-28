/**
 * Deterministic session hooks:
 *  - session/created → snapshot the container + fetch profile into cache;
 *    the systemPrompt.context() registration reads the cache synchronously
 *    on every model step, so no agent.inject() is needed.
 *  - turn/end → persist each finished turn as one supermemory document
 *    (low-value turns filtered out first). Subagent sessions are skipped
 *    for both hooks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { release as osRelease } from 'node:os';
import { activeContainer, requireUpstream } from './config.js';
import { fetchProfile } from './containers.js';
// ---------------------------------------------------------------------------
// Message-text extraction + transcript composition
// ---------------------------------------------------------------------------
/** Extract the plain-text segments from a message's content blocks. */
function messageText(content) {
    return content
        .map((block) => {
        const b = block;
        if (typeof b.text === 'string' && b.text.length > 0)
            return b.text;
        if (typeof b.content === 'string' && b.content.length > 0)
            return b.content;
        return '';
    })
        .filter((text) => text.length > 0)
        .join('\n');
}
/**
 * Compose the transcript of one finished turn into a self-contained document:
 * the real user message(s) plus the assistant replies and tool calls that were
 * produced after this turn's turn/start. Injected/synthetic user messages
 * (source.kind !== 'user') are excluded so we never persist harness noise.
 */
function turnTranscript(session, turn, maxChars = 6000) {
    const events = session.events;
    // Callers fire on turn/end: the matching turn/start is the LAST one in the
    // log (turns are sequential and this turn just ended), so scan from the
    // tail — O(this turn's events) instead of O(all events) for long sessions.
    // No per-session index state needed.
    let start = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const e = events[i];
        if (!e)
            continue; // noUncheckedIndexedAccess: sparse guard
        if (e.type === 'turn/start' && e.data.turn === turn) {
            start = i;
            break;
        }
        // Safety: never scan past the previous turn's boundary.
        if (e.type === 'turn/end' && e.data.turn === turn - 1)
            break;
    }
    if (start < 0)
        return '';
    const parts = [];
    for (let index = start; index < events.length; index += 1) {
        const e = events[index];
        if (!e)
            continue;
        if (e.type === 'turn/end')
            break;
        if (e.type === 'user/message') {
            const source = e.data.source;
            if (source?.kind !== 'user')
                continue;
            const text = messageText(e.data.content);
            if (text.length > 0)
                parts.push('User:\n' + text);
        }
        else if (e.type === 'assistant/message') {
            const text = messageText(e.data.message.content);
            if (text.length > 0)
                parts.push('Assistant:\n' + text);
        }
        else if (e.type === 'tool/call') {
            const d = e.data;
            parts.push('[tool] ' + d.name + '(' + d.arguments + ')');
        }
    }
    const text = parts.join('\n\n').trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}
// ---------------------------------------------------------------------------
// Low-value turn detection
// ---------------------------------------------------------------------------
/**
 * Low-value phrase table: every phrase here is treated as a bare
 * acknowledgment / choice / continuation command and does NOT produce a
 * memory document. Kept explicit and readable (not a giant regex) so the
 * strict-mode list is easy to extend in either language. Phrases are matched
 * EXACTLY (whitespace-normalized, case-folded) — a phrase inside a longer
 * sentence is never a match.
 */
const LOW_VALUE_PHRASES = [
    // English short confirms / acks / continuations
    'confirm', 'confirmed', 'ok', 'okay', 'k',
    'yes', 'yeah', 'yep', 'yup', 'sure', 'done', 'good', 'fine', 'great', 'nice',
    'cool', 'awesome', 'right', 'got it', 'roger', 'understood', 'copy',
    'affirmative', 'accepted', 'go', 'go ahead', 'go on', 'go for it',
    'start', 'begin', 'proceed', 'continue', 'keep going', 'next',
    'execute', 'run', 'run it', 'run this', 'do it', 'do that', 'do it now',
    'make it happen', 'i\'m on it', 'on it', 'doing it', 'will do',
    'sounds good', 'looks good', 'makes sense', 'that\'s fine',
    'yes please', 'please', 'thanks', 'thank you', 'thx', 'ty',
    // Chinese short confirms / acks / continuations
    '确认', '可以', '好的', '好', '是', '对', '行', '嗯', '恩', '哦', '啊',
    '哦哦', '嗯嗯', '对对', '是是', '收到', '明白', '知道了',
    '同意', '认可', '我认可', '开始', '开始吧', '执行', '你执行', '你逐个执行',
    '逐个执行', '继续', '你继续', '继续吧', '去吧', '来吧', '干吧', '跑',
    '跑一次', '你现在就跑一次', '重启了', '我重启了', '重启', '算了', '算了算了',
    '没关系', '可以吧', '行吧', '好的吧', '没问题', '请继续', '就这么办',
    '好的好的', '收到收到', '谢谢', '多谢',
];
const LOW_VALUE_PHRASE_SET = new Set(LOW_VALUE_PHRASES);
/** Extract the plain real-user message texts from a composed transcript. */
function extractUserMessages(transcript) {
    const re = /(?:^|\n\n)User:\n([\s\S]*?)(?=\n\nAssistant:|\n\n\[tool\]|\n\nUser:|$)/g;
    const out = [];
    let m;
    while ((m = re.exec(transcript)) !== null) {
        const text = (m[1] ?? '').trim();
        if (text)
            out.push(text);
    }
    return out;
}
/** True when a user message carries no substance (pure choice/ack/command). */
function isLowValueUserMessage(userText) {
    const s = userText.replace(/\s+/g, ' ').trim();
    if (!s)
        return true;
    // Keep only letters + digits (Unicode-aware); drop punctuation/symbols/emoji.
    const alnum = s.replace(/[^\p{L}\p{N}]/gu, '');
    if (alnum.length === 0)
        return true; // purely punctuation/symbols/emoji
    if (alnum.length === 1)
        return true; // single choice char: A / 1 / 好
    // Exact phrase match (whitespace-normalized, case-folded) against the
    // low-value table — a phrase inside a longer sentence never matches.
    return LOW_VALUE_PHRASE_SET.has(s.toLowerCase());
}
/** Strict: skip persisting when EVERY real user message in the turn is low-value. */
function isTurnLowValue(transcript) {
    const users = extractUserMessages(transcript);
    if (users.length === 0)
        return true; // no real user content -> nothing to persist
    return users.every((u) => isLowValueUserMessage(u));
}
// ---------------------------------------------------------------------------
// Context injection via systemPrompt.context()
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
/**
 * Cached profile text per session, populated asynchronously in session/created
 * and read synchronously by the systemPrompt.context() text function.
 */
const sessionProfileCache = new Map();
/**
 * Scan session events for an existing supermemory injection (survives host
 * restart / compaction). Returns the container tag embedded in the injection
 * text, or undefined if no prior injection exists.
 */
function recoverInjectedContainer(session) {
    const events = session.events;
    for (let i = 0; i < events.length; i += 1) {
        const e = events[i];
        if (!e)
            continue;
        if (e.type !== 'agent/inbox/spliced')
            continue;
        const inserted = e.data.inserted;
        if (!Array.isArray(inserted))
            continue;
        for (const msg of inserted) {
            if (msg.source?.plugin !== '@crack/dsh-supermemory')
                continue;
            const blocks = msg.content ?? [];
            for (const block of blocks) {
                const b = block;
                if (typeof b.text === 'string') {
                    const match = b.text.match(/Active memory space: (\S+)/);
                    if (match)
                        return match[1];
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
 * Per-session workspace cache: a session's cwd (and thus its workspace) never
 * changes, so resolve once and reuse. Shared by persistTurn (every turn) and
 * any future consumer; cleaned up on session/disposed.
 */
const sessionWorkspaceRef = new Map();
const workspaceResolving = new Set();
/** Resolve the workspace id owning a session (cached per session). */
async function workspaceOf(ctx, session) {
    // Cache-first: avoid re-resolving the same cwd on every turn.
    if (sessionWorkspaceRef.has(session.id))
        return sessionWorkspaceRef.get(session.id);
    // In-flight dedup: concurrent callers share one resolution.
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
/** Persist one finished turn as a supermemory document. */
async function persistTurn(ctx, scope, session, turn, text) {
    try {
        const { base, apiKey } = requireUpstream(scope);
        const customId = (session.id + '-turn-' + turn)
            .replace(/[^A-Za-z0-9_.-]/g, '-')
            .slice(0, 100);
        const workspace = await workspaceOf(ctx, session);
        // Container binding: session snapshot wins; fall back to live setting.
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
            ctx.logger.warn('supermemory turn persist: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        }
    }
    catch (error) {
        ctx.logger.warn('supermemory turn persist:', error);
    }
}
// ---------------------------------------------------------------------------
// Dynamic environment context
// ---------------------------------------------------------------------------
/** True when the session cwd is inside a git working tree. */
function isGitRepo(cwd) {
    try {
        return existsSync(join(cwd, '.git'));
    }
    catch {
        return false;
    }
}
/**
 * Detect the shell tool this DSH web host actually executes commands with.
 * The active shell executor registers as `ctx.shell` (one per context);
 * its constructor name tells us which implementation backs it:
 * PwshLocalExecutor → pwsh, LocalBashExecutor → bash.
 */
function shellName(ctx) {
    const shell = ctx.shell;
    if (shell) {
        const impl = shell.constructor?.name ?? '';
        if (impl.includes('Pwsh'))
            return 'pwsh';
        if (impl.includes('Bash'))
            return 'bash';
        return impl;
    }
    if (process.env.SHELL?.includes('bash'))
        return 'Git Bash';
    return process.platform === 'win32' ? 'cmd.exe' : 'sh';
}
/**
 * Best-effort Python environment description: uv is the package manager on
 * this machine (C:\Users\crack\.local\bin\uv.exe, uv 0.11.26); report it so
 * the model knows Python tooling should go through uv (uv run / uvx).
 */
function pythonEnv() {
    return 'uv (C:\\Users\\crack\\.local\\bin\\uv.exe)';
}
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 */
function environmentBlock(ctx, session) {
    const cwd = session.header?.cwd ?? process.cwd();
    return [
        'Primary working directory: ' + cwd,
        'Is a git repository:      ' + (isGitRepo(cwd) ? 'yes' : 'no'),
        'Platform:                 ' + process.platform,
        'Shell:                    ' + shellName(ctx),
        'OS Version:               ' + process.platform + ' ' + osRelease(),
        'Python:                   ' + pythonEnv(),
    ].join('\n');
}
/** Skip subagent sessions for both hooks. */
function isSubagent(session) {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/** Register the systemPrompt.context() + session hooks. */
export function registerSessionHooks(ctx, scope) {
    const disposers = [];
    // ── Dynamic context via systemPrompt ────────────────────────────────
    // Registered once per scoped session; the text function runs synchronously
    // on every model step, reading from the profile cache populated in
    // session/created. This replaces the old agent.inject() approach:
    // no duplicate tokens on restart/compaction, no injectedSessions Set.
    ctx.inject(['systemPrompt'], (scopedCtx) => {
        // Dynamic environment block — first context the model reads (order 5).
        disposers.push(scopedCtx.systemPrompt.context({
            name: 'supermemory:environment',
            order: 5,
            text: (context) => {
                const session = context.agent?.session;
                if (!session || isSubagent(session))
                    return '';
                return environmentBlock(ctx, session);
            },
        }));
        disposers.push(scopedCtx.systemPrompt.context({
            name: 'supermemory:recall',
            order: 200,
            text: (context) => {
                const session = context.agent?.session;
                if (!session || isSubagent(session))
                    return '';
                const container = sessionContainerRef.get(session.id) ?? activeContainer(scope);
                const profile = sessionProfileCache.get(session.id);
                if (!profile)
                    return '';
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
        if (isSubagent(session))
            return;
        void (async () => {
            try {
                // Container priority: session snapshot (from prior injection
                // event) > global setting. Keeps the session bound to its
                // original container across restarts and compactions.
                const recovered = recoverInjectedContainer(session);
                const active = recovered ?? activeContainer(scope);
                if (recovered) {
                    ctx.logger.debug('supermemory: recovered container "' + recovered + '" for session ' + session.id);
                }
                // Only set if no snapshot exists yet — never overwrite.
                if (!sessionContainerRef.has(session.id)) {
                    sessionContainerRef.set(session.id, active);
                }
                // Fetch profile and store in cache for the context text function.
                let profileText = '';
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    try {
                        profileText = await fetchProfile(scope, active);
                        if (profileText)
                            break;
                    }
                    catch { /* upstream may still be booting */ }
                    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                }
                if (profileText) {
                    sessionProfileCache.set(session.id, profileText);
                }
            }
            catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));
    // ── Turn persistence ────────────────────────────────────────────────
    disposers.push(ctx.on('session/event', (session, event) => {
        if (isSubagent(session))
            return;
        if (event.type !== 'turn/end')
            return;
        const turn = event.data.turn;
        const transcript = turnTranscript(session, turn);
        if (!transcript)
            return;
        if (isTurnLowValue(transcript))
            return;
        void persistTurn(ctx, scope, session, turn, transcript);
    }));
    return disposers;
}
