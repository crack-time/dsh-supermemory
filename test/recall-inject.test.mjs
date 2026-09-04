import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    prewarmRecall,
    bindRecall,
    dynamicRecallText,
} from '../lib/context-inject.js';

/** A fake searcher that echoes the query, avoiding any live upstream. */
function fakeSearcher(calls) {
    return (scope, container, query, limit, threshold) => {
        calls.push({ scope, container, query, limit, threshold });
        return [{ memory: 'HIT:' + query }];
    };
}

const cfg = { recallTopK: 4, recallMaxChars: 1600, recallThreshold: 0.55, recallEnabled: true };

// A minimal session: the injected code only reads `session.id`.
const session = (id) => ({ id });

test('prewarmRecall: searches once per signature (caches by normalized text)', () => {
    const calls = [];
    const search = fakeSearcher(calls);
    const s = session('sess-cache-1');
    const content = [{ type: 'text', text: '  hello    world ' }];

    prewarmRecall(null, s, 'code-dev', cfg, content, search);
    prewarmRecall(null, s, 'code-dev', cfg, [{ type: 'text', text: 'hello world' }], search);

    assert.equal(calls.length, 1); // same normalized signature -> searched once
    assert.equal(calls[0].query, 'hello world');
    assert.equal(calls[0].limit, cfg.recallTopK);
    assert.equal(calls[0].threshold, cfg.recallThreshold);
});

test('bindRecall + dynamicRecallText: renders the bound message recall from cache', () => {
    const calls = [];
    const s = session('sess-bind-1');
    const content = [{ type: 'text', text: 'what is the paper about?' }];

    bindRecall(null, s, 'code-dev', cfg, content, fakeSearcher(calls));

    const out = dynamicRecallText(s, cfg);
    assert.ok(out.includes('what is the paper about?'));
    assert.ok(out.includes('HIT:what is the paper about?'));
});

test('dynamicRecallText: empty hits inject the placeholder block (still injects)', () => {
    const empty = () => [];
    const s = session('sess-empty-1');

    bindRecall(null, s, 'code-dev', cfg, [{ type: 'text', text: 'random query' }], empty);

    const out = dynamicRecallText(s, cfg);
    assert.ok(out.includes('UNTRUSTED historical data'));
    assert.ok(out.includes('no relevant memories'));
});

test('dynamicRecallText: returns "" before any message is bound', () => {
    assert.equal(dynamicRecallText(session('sess-unbound-1'), cfg), '');
});

test('recallEnabled=false: prewarm and bind are no-ops', () => {
    const calls = [];
    const disabled = { ...cfg, recallEnabled: false };
    const s = session('sess-disabled-1');

    prewarmRecall(null, s, 'code-dev', disabled, [{ type: 'text', text: 'hi' }], fakeSearcher(calls));
    bindRecall(null, s, 'code-dev', disabled, [{ type: 'text', text: 'hi' }], fakeSearcher(calls));

    assert.equal(calls.length, 0);
    assert.equal(dynamicRecallText(s, disabled), '');
});

test('distinct messages bind distinct recall blocks for the same session', () => {
    const s = session('sess-multi-1');
    bindRecall(null, s, 'code-dev', cfg, [{ type: 'text', text: 'zeta' }], () => [{ memory: 'HIT:zeta' }]);
    const first = dynamicRecallText(s, cfg);
    assert.ok(first.includes('zeta'));

    bindRecall(null, s, 'code-dev', cfg, [{ type: 'text', text: 'omega' }], () => [{ memory: 'HIT:omega' }]);
    const second = dynamicRecallText(s, cfg);
    assert.ok(second.includes('omega'));
    assert.ok(!second.includes('HIT:zeta')); // re-bound to the newer message
});