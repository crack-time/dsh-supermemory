import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { activeContainer, requireUpstream } from './config.js';
import { discoverContainers, fetchProfile } from './containers.js';
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
const LOW_VALUE_TOKEN_RE = new RegExp('^(confirm|confirmed|ok|okay|k|yes|yeah|yep|yup|sure|done|good|fine|great|nice|'
    + 'cool|awesome|right|got[ ]it|roger|understood|copy|affirmative|accepted|'
    + 'go|go[ ]ahead|go[ ]on|go[ ]for[ ]it|start|begin|proceed|continue|keep[ ]going|next|'
    + 'execute|run|run[ ]it|run[ ]this|do[ ]it|do[ ]that|do[ ]it[ ]now|make[ ]it[ ]happen|'
    + "on[ ]it|i['’]m[ ]on[ ]it|doing[ ]it|will[ ]do|sounds[ ]good|looks[ ]good|makes[ ]sense|"
    + "that['’]s[ ]fine|yes[ ]please|please|thanks|thank[ ]you|thx|ty|"
    + '确认|可以|好的|好|是|对|行|嗯|恩|哦|啊|哦哦|嗯嗯|对对|是是|收到|明白|知道了|'
    + '同意|认可|我认可|开始|开始吧|执行|你执行|你逐个执行|逐个执行|继续|你继续|继续吧|'
    + '去吧|来吧|干吧|跑|跑一次|你现在就跑一次|重启了|我重启了|重启|算了|算了算了|没关系|'
    + '可以吧|行吧|好的吧|没问题|请继续|就这么办|好的好的|收到收到|谢谢|多谢)$', 'i');
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
    return LOW_VALUE_TOKEN_RE.test(s.toLowerCase());
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
            content: [{ type: 'text', text: '[Memory Context (from local supermemory)]\n' + text }],
            source: { kind: 'plugin', plugin: '@crack/dsh-supermemory', form: 'recall' },
        }));
    }
    catch (error) {
        ctx.logger.warn('supermemory context inject:', error);
    }
}
/** Sessions that already received a profile injection (one per session). */
const injectedSessions = new Set();
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
        const res = await fetch(base + '/v3/documents', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
                content: text,
                containerTag: activeContainer(scope),
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
    disposers.push(ctx.on('session/created', (session) => {
        if (isSubagent(session))
            return;
        if (injectedSessions.has(session.id))
            return;
        injectedSessions.add(session.id);
        const log = (msg) => ctx.logger.info('[supermemory] session/created: ' + msg);
        void (async () => {
            try {
                const { base, apiKey } = requireUpstream(scope);
                log('base=' + base + ' apiKey=' + (apiKey ? apiKey.slice(0, 10) + '...' : '(empty)'));
                let entries = [];
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    try {
                        entries = await discoverContainers(base, apiKey);
                        if (entries.length > 0)
                            break;
                    }
                    catch (err) {
                        log('discover attempt ' + (attempt + 1) + ' failed: ' + (err instanceof Error ? err.message : String(err)));
                    }
                    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                }
                log('entries: ' + JSON.stringify(entries.map((c) => c.tag + ':' + c.staticCount + 's+' + c.dynamicCount + 'd+' + c.docCount + 'docs')));
                const containerLines = entries
                    .map((c) => '- ' + c.tag + ': ' + c.staticCount + ' static + ' + c.dynamicCount + ' dynamic (' + c.docCount + ' docs)')
                    .join('\n') || '- ' + activeContainer(scope) + ' (default, 0 memories)';
                const active = activeContainer(scope);
                let profileText = '';
                if (active) {
                    try {
                        profileText = await fetchProfile(scope, active);
                    }
                    catch { /* optional */ }
                }
                const guidance = '[Memory Context (from local supermemory)]\n' +
                    (profileText ? profileText + '\n\n' : '') +
                    'Active memory space: ' + active + '\n' +
                    'Available memory spaces (change it in dsh Settings → Supermemory → "当前记忆空间"):\n' +
                    containerLines + '\n' +
                    '[SYSTEM INSTRUCTION] If the user asks about memory, use the active memory space above.';
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
