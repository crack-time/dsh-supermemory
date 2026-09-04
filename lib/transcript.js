/** Extract the plain-text segments from a message content blocks. */
export function messageText(content) {
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
 * Compose one finished turn span from an event list: backward scan to the
 * matching turn/start, then forward render until that turn's turn/end.
 */
function turnSpan(events, turn, maxChars) {
    let start = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const e = events[i];
        if (!e)
            continue;
        if (e.type === 'turn/start' && e.data.turn === turn) {
            start = i;
            break;
        }
        if (e.type === 'turn/end' && e.data.turn === turn - 1)
            break;
    }
    if (start < 0)
        return '';
    return composeEvents(events, start, maxChars, true);
}
/** Compose the transcript of ONE finished turn into a self-contained document. */
export function turnTranscript(session, turn, maxChars = 6000) {
    return turnSpan(session.snapshotEvents(), turn, maxChars);
}
/**
 * Compose the transcript of an ENTIRE session from its full event history.
 *
 * Unlike turnTranscript (one turn, backward scan + break at turn/end), this
 * walks the whole log forward and keeps going across turn boundaries, so it is
 * suitable for the archive-time write where the session's complete span is
 * needed regardless of how memory- resident or cold the session is.
 */
export function sessionTranscript(session, maxChars = 6000) {
    return composeEvents(session.snapshotEvents(), 0, maxChars, false);
}
/** Render one session event span into its transcript text; '' when nothing captured. */
function composeEvents(events, start, maxChars, stopAtTurnEnd) {
    const parts = [];
    for (let index = start; index < events.length; index += 1) {
        const e = events[index];
        if (!e)
            continue;
        if (e.type === 'turn/end') {
            if (stopAtTurnEnd)
                break;
            continue;
        }
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
