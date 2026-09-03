import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallSignature, clampTopK, renderRecall, filterSearchHits } from '../lib/recall.js';

test('recallSignature: trims and collapses whitespace across runs', () => {
    assert.equal(recallSignature('  hello    world '), 'hello world');
    assert.equal(recallSignature('你好  世界'), '你好 世界');
    assert.equal(recallSignature('\t\n  \n x \n'), 'x');
});

test('clampTopK: clamps into [1,10]', () => {
    assert.equal(clampTopK(0), 1);
    assert.equal(clampTopK(99), 10);
    assert.equal(clampTopK(4.9), 4);
    assert.equal(clampTopK(4), 4);
});

test('renderRecall: empty hits default to a "no memories" placeholder block', () => {
    const out = renderRecall([], 4, 1600);
    assert.ok(out.includes('UNTRUSTED historical data'));
    assert.ok(out.includes('目前无相关记忆'), 'empty recall must render a placeholder, not silently omit');
    const undef = renderRecall(undefined, 4, 1600);
    assert.ok(undef.includes('目前无相关记忆'));
});

test('renderRecall: emptyText="" restores the old drop-on-empty behaviour', () => {
    assert.equal(renderRecall([], 4, 1600, ''), '');
    assert.equal(renderRecall(undefined, 4, 1600, ''), '');
});

test('renderRecall: marks block untrusted, caps topK', () => {
    const hits = Array.from({ length: 12 }, (_, i) => ({ memory: 'm' + i }));
    const out = renderRecall(hits, 4, 9999);
    assert.ok(out.includes('UNTRUSTED historical data'));
    assert.ok(out.includes('- m0'));
    assert.ok(out.includes('- m3'));
    assert.ok(!out.includes('m4'), 'must not render beyond topK');
});

test('renderRecall: respects maxChars and truncates the body (header excluded)', () => {
    const hits = [{ memory: 'a'.repeat(500) }, { memory: 'b'.repeat(500) }];
    const out = renderRecall(hits, 4, 200);
    const body = out.slice(out.indexOf('\n') + 1); // drop the untrusted-marking header line
    assert.ok(body.length <= 200 + 2, 'body must be capped at maxChars (+ newline + ellipsis)');
    assert.ok(out.endsWith('…'));
});

test('filterSearchHits: drops hits below the threshold', () => {
    const raw = [
        { memory: 'high', similarity: 0.9, rootMemoryId: 'h1' },
        { memory: 'low', similarity: 0.3, rootMemoryId: 'l1' },
    ];
    const out = filterSearchHits(raw, 0.55);
    assert.deepEqual(out.map((m) => m.memory), ['high']);
});

test('filterSearchHits: de-duplicates by rootMemoryId keeping the best similarity', () => {
    const raw = [
        { memory: 'same (weak)', similarity: 0.6, rootMemoryId: 'r1' },
        { memory: 'same (strong)', similarity: 0.9, rootMemoryId: 'r1' },
        { memory: 'other', similarity: 0.8, rootMemoryId: 'r2' },
    ];
    const out = filterSearchHits(raw, 0.5);
    assert.deepEqual(out.map((m) => m.memory), ['same (strong)', 'other']);
});

test('filterSearchHits: keeps hits without similarity, dedups by text when no rootMemoryId', () => {
    const raw = [
        { memory: 'no-score A' },
        { memory: 'no-score B' },
        { memory: 'no-score A' },
    ];
    const out = filterSearchHits(raw, 0.55);
    assert.deepEqual(out.map((m) => m.memory), ['no-score A', 'no-score B']);
});

test('filterSearchHits: tolerates non-array / empty input', () => {
    assert.deepEqual(filterSearchHits(undefined, 0.5), []);
    assert.deepEqual(filterSearchHits([], 0.5), []);
    assert.deepEqual(filterSearchHits([null, {}, { memory: '' }], 0.5), []);
});