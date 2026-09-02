/**
 * Turn transcript composition: extract human-readable text from a finished
 * turn event span so it can be persisted as a supermemory document.
 *
 * Excluded: injected/synthetic messages (source.kind !== "user") and tool
 * result details — only user queries, assistant replies, and tool call
 * signatures are captured.
 */
import type { Session } from '@deepseek-ai/dsh-session';

/** Extract the plain-text segments from a message content blocks. */
function messageText(content: readonly unknown[]): string {
    return content
        .map((block): string => {
            const b = block as { type?: string; text?: string; content?: unknown };
            if (typeof b.text === 'string' && b.text.length > 0) return b.text;
            if (typeof b.content === 'string' && b.content.length > 0) return b.content;
            return '';
        })
        .filter((text) => text.length > 0)
        .join('\n');
}

/**
 * Compose the transcript of one finished turn into a self-contained document.
 *
 * Scans from the tail of the event log — the matching turn/start is the last
 * one (turns are sequential, this turn just ended) — so the cost is
 * O(this turn events) rather than O(all events) for long sessions.
 */
export function turnTranscript(session: Session, turn: number, maxChars = 6000): string {
    const events = session.snapshotEvents();
    let start = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const e = events[i];
        if (!e) continue;
        if (e.type === 'turn/start' && (e.data as { turn: number }).turn === turn) {
            start = i;
            break;
        }
        if (e.type === 'turn/end' && (e.data as { turn: number }).turn === turn - 1) break;
    }
    if (start < 0) return '';
    const parts: string[] = [];
    for (let index = start; index < events.length; index += 1) {
        const e = events[index];
        if (!e) continue;
        if (e.type === 'turn/end') break;
        if (e.type === 'user/message') {
            const source = (e.data as { source?: { kind?: string } }).source;
            if (source?.kind !== 'user') continue;
            const text = messageText((e.data as { content: readonly unknown[] }).content);
            if (text.length > 0) parts.push('User:\n' + text);
        }
        else if (e.type === 'assistant/message') {
            const text = messageText(
                (e.data as { message: { content: readonly unknown[] } }).message.content,
            );
            if (text.length > 0) parts.push('Assistant:\n' + text);
        }
        else if (e.type === 'tool/call') {
            const d = e.data as { name: string; arguments: string };
            parts.push('[tool] ' + d.name + '(' + d.arguments + ')');
        }
    }
    const text = parts.join('\n\n').trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}
