import { createUserMessage } from '@deepseek-ai/dsh-llm';
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
    const start = events.findIndex((e) => e.type === 'turn/start' && e.data.turn === turn);
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
// Context injection
// ---------------------------------------------------------------------------
/** Inject recall context into the session's agent as a synthetic user message. */
function injectContext(ctx, session, text) {
    const agent = ctx.agents.get(session.id);
    if (!agent)
        return;
    try {
        agent.inject(createUserMessage({
            content: [{ type: 'text', text: '[Memory Context (from local supermemory)]\n\n' + text }],
            source: { kind: 'plugin', plugin: '@crack/dsh-supermemory', form: 'recall' },
        }));
    }
    catch (error) {
        ctx.logger.warn('supermemory context inject:', error);
    }
}
/** Sessions that already received a profile injection (one per session). */
const injectedSessions = new Set();
/**
 * Per-session container snapshot, taken at session/created and used by
 * turn/end persistence — so injection and writes stay bound to the SAME
 * space even if the user switches the global activeContainer mid-session
 * (the switch only affects NEW sessions). Missing entry falls back to the
 * live global setting (legacy sessions created before this snapshot).
 */
const sessionContainerRef = new Map();
// ---------------------------------------------------------------------------
// Turn persistence — one document per finished turn (low-value turns are
// filtered out before reaching this point).
// ---------------------------------------------------------------------------
/** Resolve the workspace id owning a session. */
async function workspaceOf(ctx, session) {
    try {
        const cwd = session.header?.cwd;
        const workspace = cwd ? await ctx.workspaceRegistry.resolveByPath(cwd) : undefined;
        const found = workspace ?? ctx.workspaceRegistry.list().find((w) => w.sessionIds.includes(session.id));
        if (!found)
            return undefined;
        return String(found.id);
    }
    catch (error) {
        ctx.logger.warn('supermemory workspace resolve:', error);
        return undefined;
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
        // Container binding: session snapshot wins (taken at session/created);
        // fall back to the live setting for legacy sessions without one.
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
/** Skip subagent sessions for both hooks. */
function isSubagent(session) {
    return session.header.origin === 'subagent'
        || (session.header.delegationDepth ?? 0) > 0;
}
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/** Register the session/created injection and per-turn persistence. */
export function registerSessionHooks(ctx, scope) {
    const disposers = [];
    // Release per-session state when a session leaves the store.
    disposers.push(ctx.on('session/disposed', (session) => {
        injectedSessions.delete(session.id);
        sessionContainerRef.delete(session.id);
    }));
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session))
            return;
        if (injectedSessions.has(session.id))
            return;
        injectedSessions.add(session.id);
        void (async () => {
            try {
                const active = activeContainer(scope);
                // Snapshot the container for THIS session: turn/end persistence
                // uses it so writes always stay in the injected space, even if
                // the user switches the global setting mid-session.
                sessionContainerRef.set(session.id, active);
                // Fetch the ACTIVE container's profile only — the container was
                // chosen by the user in the settings card, so no container list
                // is needed (and no full document scan).
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
                // injectContext already prepends the '[Memory Context ...]' header;
                // keep 'Active memory space' FIRST so the model always knows the
                // bound space before reading any facts.
                const guidance = 'Active memory space: ' + active + '\n\n' +
                    (profileText ? profileText : '') +
                    (profileText ? '\n\n' : '') +
                    '[SYSTEM INSTRUCTION] Memory queries default to the active memory space above.';
                injectContext(ctx, session, guidance);
            }
            catch (error) {
                ctx.logger.warn('supermemory session init:', error);
            }
        })();
    }));
    disposers.push(ctx.on('session/event', (session, event) => {
        if (event.type !== 'turn/end')
            return;
        if (isSubagent(session))
            return;
        const turn = event.data.turn;
        const transcript = turnTranscript(session, turn);
        if (!transcript)
            return;
        // Strict low-value gate: skip persisting bare acknowledgments /
        // single-character choices / commands ("确认", "A", "do it", ...).
        if (isTurnLowValue(transcript))
            return;
        // One document per finished turn (fire-and-forget).
        void persistTurn(ctx, scope, session, turn, transcript);
    }));
    return disposers;
}
