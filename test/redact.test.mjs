import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskApiKey } from '../lib/redact.js';

test('maskApiKey: empty stays empty', () => {
    assert.equal(maskApiKey(''), '');
});

test('maskApiKey: short keys fully masked', () => {
    assert.equal(maskApiKey('abcdefgh'), '****');
    assert.equal(maskApiKey('abc'), '****');
});

test('maskApiKey: longer keys keep first4 + **** + last4', () => {
    assert.equal(maskApiKey('sk-0123456789abcdef'), 'sk-0****cdef');
    assert.equal(maskApiKey('sk-0123456789abcdef0123'), 'sk-0****0123');
});