import { activeContainer, argString, requireUpstream } from '../config.js';
import { apiFetch } from '../upstream.js';
/**
 * supersonic semantic search tool: model-facing recall over the local
 * Supermemory store.
 */
export function makeSearchTool(scope) {
    return {
        name: 'supermemory_search',
        description: 'Search the local Supermemory memory store (semantic retrieval, cross-language): recall previously saved facts, fixes, preferences and environment notes.\n' +
            'Call this tool when ANY of these triggers apply:\n' +
            '1. The user references past content ("before / last time / earlier / yesterday" something was fixed, said, or resolved);\n' +
            '2. You need precise details (paths, ports, model names, commands, error codes) that the injected memory summary may have compressed;\n' +
            '3. The conversation topic drifted to an area not covered by the injected profile;\n' +
            '4. You are about to reuse or re-verify a previously established decision or fix;\n' +
            '5. Resuming an old topic after a long gap.\n' +
            'Do NOT call it when the injected profile already answers the question, or for brand-new tasks unrelated to stored history.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to look for, any language (e.g. "how was the embedding model fixed").',
                },
                containerTag: {
                    type: 'string',
                    description: 'Scope the search to one container tag.',
                    default: '',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (1–20).',
                    default: 5,
                },
            },
            required: ['query'],
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { memory: { type: 'string' } },
                            required: ['memory'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['results'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const results = value.results ?? [];
                if (results.length === 0)
                    return [{ type: 'text', text: 'No matching memories found.' }];
                const lines = results.map((r, i) => `${i + 1}. ${r.memory ?? ''}`.trimEnd());
                return [{ type: 'text', text: `Memory search results (${lines.length}):\n${lines.join('\n')}` }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const query = argString(a.query, '');
            if (!query)
                throw new Error('supermemory_search: query (non-empty string) is required');
            const tag = argString(a.containerTag, activeContainer(scope));
            const raw = typeof a.limit === 'number' && Number.isFinite(a.limit) ? Math.floor(a.limit) : 5;
            const limit = Math.min(20, Math.max(1, raw));
            const { base, apiKey } = requireUpstream(scope);
            const data = await apiFetch(base, apiKey, '/v4/search', {
                method: 'POST',
                body: { q: query, containerTag: tag, threshold: 0.5, limit },
                signal: exec.signal,
            });
            const results = (data.memories ?? data.results ?? [])
                .map((m) => ({ memory: m.memory ?? '' }))
                .filter((m) => m.memory.length > 0);
            return { results };
        },
        timeoutMs: 30000,
    };
}
/**
 * Memory-write tool: persist an entity-centric fact into the local
 * Supermemory store (embeddings generated server-side, immediately
 * searchable).
 */
export function makeSaveTool(scope) {
    return {
        name: 'supermemory_save',
        description: 'Save a memory into the local Supermemory store (indexed, semantically retrievable). Use for durable facts: preferences, environment details, completed fixes.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'Entity-centric memory text, e.g. "supermemory downloads models via hf-mirror.com" (max 10000 chars).',
                },
                isStatic: {
                    type: 'boolean',
                    description: 'True for permanent traits/facts; false for ephemeral notes.',
                    default: false,
                },
                containerTag: {
                    type: 'string',
                    description: 'Container tag to save under.',
                    default: '',
                },
            },
            required: ['content'],
        },
        output: {
            schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, created: { type: 'number' } },
                required: ['ok', 'created'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const created = value.created ?? 0;
                return [{ type: 'text', text: created > 0 ? `Saved ${created} memories.` : 'Save failed.' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const content = argString(a.content, '');
            if (!content)
                throw new Error('supermemory_save: content (non-empty string) is required');
            if (content.length > 10000)
                throw new Error('supermemory_save: content exceeds 10000 chars');
            const isStatic = a.isStatic === true;
            const tag = argString(a.containerTag, activeContainer(scope));
            const { base, apiKey } = requireUpstream(scope);
            const data = await apiFetch(base, apiKey, '/v4/memories', {
                method: 'POST',
                body: { memories: [{ content, isStatic }], containerTag: tag },
                signal: exec.signal,
            });
            const created = Array.isArray(data.memories) ? data.memories.length : 1;
            return { ok: true, created };
        },
        timeoutMs: 20000,
    };
}
