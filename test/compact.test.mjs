import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactTranscript } from '../lib/compact.js';

const fakeScope = (cfg) => ({ get: () => ({ ...cfg }) });

const configured = {
    openaiBaseUrl: 'https://llm.example/v1',
    openaiApiKey: 'k-test',
    openaiModel: 'm-test',
};

test('compactTranscript: not configured => input unchanged, compacted=false', async () => {
    const scope = fakeScope({
        openaiBaseUrl: '',
        openaiApiKey: '',
        openaiModel: '',
    });
    const res = await compactTranscript(scope, 'plain transcript');
    assert.equal(res.text, 'plain transcript');
    assert.equal(res.compacted, false);
});

test('compactTranscript: success => returns model completion', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        assert.ok(String(url).endsWith('/chat/completions'), 'POSTs to /chat/completions');
        assert.equal(opts.headers.authorization, 'Bearer k-test');
        assert.equal(JSON.parse(opts.body).model, 'm-test');
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'CONDENSED RESULT' } }] }),
        };
    };
    try {
        const res = await compactTranscript(fakeScope(configured), 'long transcript content');
        assert.equal(res.text, 'CONDENSED RESULT');
        assert.equal(res.compacted, true);
    }
    finally {
        globalThis.fetch = origFetch;
    }
});

test('compactTranscript: HTTP error => input unchanged', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false });
    try {
        const res = await compactTranscript(fakeScope(configured), 'some text');
        assert.equal(res.text, 'some text');
        assert.equal(res.compacted, false);
    }
    finally {
        globalThis.fetch = origFetch;
    }
});

test('compactTranscript: empty completion => input unchanged', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    });
    try {
        const res = await compactTranscript(fakeScope(configured), 'content');
        assert.equal(res.text, 'content');
        assert.equal(res.compacted, false);
    }
    finally {
        globalThis.fetch = origFetch;
    }
});

test('compactTranscript: empty input => unchanged without a call', async () => {
    let called = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
    };
    try {
        const res = await compactTranscript(fakeScope(configured), '   ');
        assert.equal(res.text, '   ');
        assert.equal(res.compacted, false);
        assert.equal(called, false, 'must not call the endpoint for empty input');
    }
    finally {
        globalThis.fetch = origFetch;
    }
});