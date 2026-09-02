import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnTranscript } from '../lib/transcript.js';

const turnStart = (turn) => ({ type: 'turn/start', data: { turn } });
const turnEnd = (turn) => ({ type: 'turn/end', data: { turn } });
const userMsg = (text, kind = 'user') => ({
    type: 'user/message',
    data: { source: { kind }, content: [{ type: 'text', text }] },
});
const asstMsg = (text) => ({
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
});
const toolCall = (name, args) => ({ type: 'tool/call', data: { name, arguments: args } });

function fakeSession(events) {
    return { id: 's1', snapshotEvents: () => events };
}

test('turnTranscript: extracts user/assistant/tool, skips injected, stops at turn/end', () => {
    const events = [
        turnStart(1),
        userMsg('How does uv cache work?'),
        toolCall('supermemory_search', '{"query":"uv cache"}'),
        asstMsg('It caches under ~/.cache/uv.'),
        userMsg('[system reminder] injected — should be skipped', 'injected'),
        turnEnd(1),
    ];
    const out = turnTranscript(fakeSession(events), 1);
    assert.ok(out.includes('User:\nHow does uv cache work?'));
    assert.ok(out.includes('[tool] supermemory_search({"query":"uv cache"})'));
    assert.ok(out.includes('Assistant:\nIt caches under ~/.cache/uv.'));
    assert.ok(!out.includes('injected'), 'injected/synthetic messages must be excluded');
    assert.ok(!out.includes('User:\n[system'), 'non-user-source blocked not included');
});

test('turnTranscript: no matching turn/start for the requested turn => empty', () => {
    const events = [turnStart(1), userMsg('hi'), turnEnd(1)];
    assert.equal(turnTranscript(fakeSession(events), 5), '');
});

test('turnTranscript: respects the maxChars cap', () => {
    const events = [turnStart(1), userMsg('a'.repeat(200)), asstMsg('b'.repeat(200)), turnEnd(1)];
    const out = turnTranscript(fakeSession(events), 1, 100);
    assert.ok(out.length <= 100);
});