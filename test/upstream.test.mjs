import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerTagsOf, docInContainer } from '../lib/upstream.js';

test('containerTagsOf: prefers the plural array, trims + filters empties', () => {
    assert.deepEqual(
        containerTagsOf({ id: 'a', containerTags: [' code-dev ', '', 'phd'] }),
        ['code-dev', 'phd'],
    );
});

test('containerTagsOf: falls back to the legacy singular field', () => {
    assert.deepEqual(containerTagsOf({ id: 'a', containerTag: 'code-dev' }), ['code-dev']);
});

test('containerTagsOf: neither field is empty', () => {
    assert.deepEqual(containerTagsOf({ id: 'a' }), []);
    assert.deepEqual(containerTagsOf({ id: 'a', containerTag: '', containerTags: [''] }), []);
});

test('docInContainer: membership over both container shapes', () => {
    assert.equal(docInContainer({ id: 'a', containerTags: ['code-dev', 'phd'] }, 'code-dev'), true);
    assert.equal(docInContainer({ id: 'a', containerTag: 'phd' }, 'code-dev'), false);
    assert.equal(docInContainer({ id: 'a' }, 'code-dev'), false);
});