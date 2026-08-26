/**
 * AI-facing memory tools registered into the dsh tool runtime. Host-side calls
 * with the configured Bearer key — the model never sees credentials and
 * nothing crosses the browser origin. Container discovery shares
 * discoverContainers (the settings card is the single switch path).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, argString, requireUpstream } from './config.ts';
import { discoverContainers } from './containers.ts';

/**
 * supersonic semantic search tool: model-facing recall over the local
 * Supermemory store.
 */
function makeSearchTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_search',
        description:
            'Search the local Supermemory memory store (semantic retrieval, cross-language): recall previously saved facts, fixes, preferences and environment notes.\n' +
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
                const results = (value as { results?: Array<{ memory?: string }> }).results ?? [];
                if (results.length === 0) return [{ type: 'text', text: 'No matching memories found.' }];
                const lines = results.map((r, i) => `${i + 1}. ${r.memory ?? ''}`.trimEnd());
                return [{ type: 'text', text: `Memory search results (${lines.length}):\n${lines.join('\n')}` }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { query?: unknown; containerTag?: unknown; limit?: unknown };
            const query = argString(a.query, '');
            if (!query) throw new Error('supermemory_search: query (non-empty string) is required');
            const tag = argString(a.containerTag, activeContainer(scope));
            const raw = typeof a.limit === 'number' && Number.isFinite(a.limit) ? Math.floor(a.limit) : 5;
            const limit = Math.min(20, Math.max(1, raw));
            const { base, apiKey } = requireUpstream(scope);
            const res = await fetch(base + '/v4/search', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ q: query, containerTag: tag, threshold: 0.5, limit }),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error(`supermemory /v4/search failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
            }
            const data = (await res.json()) as {
                memories?: Array<{ memory?: string }>;
                results?: Array<{ memory?: string }>;
            };
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
function makeSaveTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_save',
        description:
            'Save a memory into the local Supermemory store (indexed, semantically retrievable). Use for durable facts: preferences, environment details, completed fixes.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description:
                        'Entity-centric memory text, e.g. "supermemory downloads models via hf-mirror.com" (max 10000 chars).',
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
                const created = (value as { created?: number }).created ?? 0;
                return [{ type: 'text', text: created > 0 ? `Saved ${created} memories.` : 'Save failed.' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { content?: unknown; isStatic?: unknown; containerTag?: unknown };
            const content = argString(a.content, '');
            if (!content) throw new Error('supermemory_save: content (non-empty string) is required');
            if (content.length > 10000) throw new Error('supermemory_save: content exceeds 10000 chars');
            const isStatic = a.isStatic === true;
            const tag = argString(a.containerTag, activeContainer(scope));
            const { base, apiKey } = requireUpstream(scope);
            const res = await fetch(base + '/v4/memories', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ memories: [{ content, isStatic }], containerTag: tag }),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error(`supermemory /v4/memories failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
            }
            const data = (await res.json()) as { memories?: Array<{ id?: string }> };
            const created = Array.isArray(data.memories) ? data.memories.length : 1;
            return { ok: true, created };
        },
        timeoutMs: 20000,
    };
}

/**
 * Memory-forget tool: delete memories from the local Supermemory store —
 * either exact memory ids, or a natural-language query the server matches
 * semantically. dryRun previews before any mutation.
 */
function makeForgetTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_forget',
        description:
            'Delete or forget memories in the local Supermemory store. Pass exact memory ids, or a natural-language query/topic the server matches semantically; use dryRun to preview first. Use it to clean up wrong, outdated or test memories.',
        parameters: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exact memory ids to forget (no semantic matching). Either ids or query is required.',
                },
                query: {
                    type: 'string',
                    description: 'Natural-language instruction ("forget everything about Project Titan") or a bare topic ("Project Titan"). Either ids or query is required.',
                },
                containerTag: {
                    type: 'string',
                    description: 'Container tag / space the forget operation is scoped to.',
                    default: '',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'When true, only preview which memories WOULD be forgotten (no mutation).',
                    default: false,
                },
                threshold: {
                    type: 'number',
                    description: 'Minimum cosine similarity for semantic matching (lower = wider net).',
                    default: 0.5,
                },
                maxForget: {
                    type: 'number',
                    description: 'Maximum number of memories this call may forget (1–500).',
                    default: 100,
                },
                reason: {
                    type: 'string',
                    description: 'Optional reason stored as forgetReason on each memory.',
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    dryRun: { type: 'boolean' },
                    count: { type: 'number' },
                    forgetBatchId: { type: 'string' },
                    summary: { type: 'string' },
                },
                required: ['dryRun', 'count', 'summary'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { dryRun?: boolean; count?: number; summary?: string };
                const prefix = v.dryRun ? ' (dry run, nothing deleted)' : '';
                return [{ type: 'text', text: 'supermemory_forget' + prefix + ': ' + (v.summary ?? '') + ' (' + (v.count ?? 0) + ' items)' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as {
                ids?: unknown; query?: unknown; containerTag?: unknown;
                dryRun?: unknown; threshold?: unknown; maxForget?: unknown; reason?: unknown;
            };
            const ids = Array.isArray(a.ids)
                ? a.ids
                    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                    .map((x) => x.trim())
                : [];
            const query = argString(a.query, '');
            if (ids.length === 0 && !query) {
                throw new Error('supermemory_forget: provide either ids (non-empty array) or query (non-empty string)');
            }
            if (ids.length > 500) throw new Error('supermemory_forget: at most 500 ids');
            const tag = argString(a.containerTag, activeContainer(scope));
            const dryRun = a.dryRun === true;
            const rawThreshold = typeof a.threshold === 'number' && Number.isFinite(a.threshold) ? a.threshold : 0.5;
            const threshold = Math.min(1, Math.max(0, rawThreshold));
            const rawMax = typeof a.maxForget === 'number' && Number.isFinite(a.maxForget) ? Math.floor(a.maxForget) : 100;
            const maxForget = Math.min(500, Math.max(1, rawMax));
            const reason = argString(a.reason, '');
            const { base, apiKey } = requireUpstream(scope);
            const body: Record<string, unknown> = { containerTag: tag, dryRun, threshold, maxForget };
            if (ids.length > 0) body.ids = ids;
            if (query) body.query = query;
            if (reason) body.reason = reason;
            const res = await fetch(base + '/v4/memories/forget-matching', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error('supermemory /v4/memories/forget-matching failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
            }
            const data = (await res.json()) as {
                dryRun?: boolean; count?: number; forgetBatchId?: string | null; summary?: string;
            };
            return {
                dryRun: data.dryRun === true,
                count: typeof data.count === 'number' ? data.count : 0,
                forgetBatchId: data.forgetBatchId ?? '',
                summary: data.summary ?? '',
            };
        },
        timeoutMs: 30000,
    };
}

/**
 * Delete-document tool: remove supermemory documents (raw conversation-turn
 * records) by exact id(s). Deleting a document CASCADE-deletes the memories it
 * produced — the user accepts this by default. Guarded: dryRun previews and
 * confirm:true is required to actually delete.
 */
function makeDeleteDocumentTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_delete_document',
        description:
            'Delete supermemory documents (raw conversation-turn records) by EXPLICIT id(s) only. WARNING: deleting a document CASCADE-deletes the memories it produced. Whitelist-only: you must pass exact document ids; bulk-container deletion is intentionally disabled to prevent accidental loss. Always dryRun first (returns titles for review), then pass confirm:true with id(s) to actually delete.',
        parameters: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exact document ids to delete (required, max 100 per call). Bulk-container deletion is disabled — you must list every id explicitly.',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'When true, only preview which documents WOULD be deleted (returns titles for human review, no cascade).',
                    default: true,
                },
                confirm: {
                    type: 'boolean',
                    description: 'Required to actually delete. Must be true to perform the deletion (guards against accidental cascade memory loss).',
                    default: false,
                },
            },
            required: ['ids'],
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    dryRun: { type: 'boolean' },
                    deleted: { type: 'number' },
                    summary: { type: 'string' },
                    documents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                            },
                            required: ['id'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['dryRun', 'deleted', 'summary'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { dryRun?: boolean; deleted?: number; summary?: string };
                const prefix = v.dryRun ? ' (dry run, nothing deleted)' : '';
                return [{ type: 'text', text: 'supermemory_delete_document' + prefix + ': ' + (v.summary ?? '') + ' (' + (v.deleted ?? 0) + ' documents)' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {}) as { ids?: unknown; dryRun?: unknown; confirm?: unknown };
            const ids = Array.isArray(a.ids)
                ? a.ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
                : [];
            // HARD GUARD: whitelist-only. Bulk-container deletion is disabled.
            if (ids.length === 0) throw new Error('supermemory_delete_document: ids (non-empty array) is required — bulk-container deletion is disabled to prevent accidental loss. List exact document ids.');
            if (ids.length > 100) throw new Error('supermemory_delete_document: at most 100 ids per call');
            const dryRun = a.dryRun === true;
            const confirm = a.confirm === true;
            const { base, apiKey } = requireUpstream(scope);

            // Build targets (id + resolved title from the list endpoint for review).
            const targets: Array<{ id: string; title: string }> = [];
            // List all documents (no containerTag filter) to resolve titles for any id.
            const listRes = await fetch(base + '/v3/documents/list', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ limit: 1000 }),
                signal: exec.signal,
            });
            if (listRes.ok) {
                const listData = (await listRes.json()) as { memories?: Array<{ id: string; title?: string }> };
                const known = new Map<string, string>((listData.memories ?? []).map((d) => [d.id, d.title ?? '']));
                for (const id of ids) targets.push({ id, title: known.get(id) ?? '' });
            } else {
                for (const id of ids) targets.push({ id, title: '' });
            }

            if (dryRun) {
                return {
                    dryRun: true,
                    deleted: 0,
                    summary: 'Dry run: ' + targets.length + ' document(s) would be deleted (cascade-deleting their memories). Titles shown for review; pass confirm:true to actually delete.',
                    documents: targets,
                };
            }

            if (!confirm) {
                throw new Error('supermemory_delete_document: confirm:true is required to actually delete — this CASCADE-deletes the documents produced memories. Re-check with dryRun first.');
            }

            let deleted = 0;
            for (let i = 0; i < ids.length; i += 100) {
                const batch = ids.slice(i, i + 100);
                const delRes = await fetch(base + '/v3/documents/bulk', {
                    method: 'DELETE',
                    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                    body: JSON.stringify({ ids: batch }),
                    signal: exec.signal,
                });
                if (delRes.ok) {
                    const d = (await delRes.json()) as { deleted?: number; deletedDocs?: number };
                    deleted += d.deleted ?? d.deletedDocs ?? batch.length;
                } else {
                    for (const id of batch) {
                        const singleRes = await fetch(base + '/v3/documents/' + id, {
                            method: 'DELETE',
                            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                            signal: exec.signal,
                        });
                        if (singleRes.ok) deleted++;
                    }
                }
            }

            return {
                dryRun: false,
                deleted,
                summary: 'Deleted ' + deleted + ' document(s) (and their produced memories).',
                documents: targets.map((t) => ({ id: t.id, title: t.title })),
            };
        },
        timeoutMs: 60000,
    };
}

/**
 * List-containers tool: show all memory spaces with their fact counts.
 */
function makeListContainersTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_list_containers',
        description: 'List all memory spaces (container tags) with their fact counts. Use this to see what spaces exist before selecting one.',
        parameters: {
            type: 'object',
            properties: {},
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                tag: { type: 'string' },
                                staticCount: { type: 'number' },
                                dynamicCount: { type: 'number' },
                            },
                            required: ['tag'],
                        },
                    },
                    active: { type: 'string' },
                },
                required: ['containers', 'active'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containers?: Array<{ tag: string; staticCount?: number; dynamicCount?: number }>; active?: string };
                const lines = (v.containers ?? []).map((c) => {
                    const marker = c.tag === v.active ? ' (active)' : '';
                    return '  - ' + c.tag + marker + ': ' + (c.staticCount ?? 0) + ' static + ' + (c.dynamicCount ?? 0) + ' dynamic';
                });
                const header = 'Memory spaces (' + (v.containers ?? []).length + '):';
                return [{ type: 'text', text: header + '\n' + lines.join('\n') }];
            },
        },
        execute: async () => {
            const { base, apiKey } = requireUpstream(scope);
            const active = activeContainer(scope);
            const entries = await discoverContainers(base, apiKey);
            const containers = entries.map((c) => ({
                tag: c.tag,
                staticCount: c.staticCount,
                dynamicCount: c.dynamicCount,
            }));
            return { containers, active };
        },
        timeoutMs: 20000,
    };
}

/**
 * List-documents tool: show documents in a memory space.
 */
function makeListDocumentsTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_list_documents',
        description: 'List documents stored in a specific memory space (container tag). Returns document ids, titles, and metadata. Use this to review what is stored before deleting or managing documents.',
        parameters: {
            type: 'object',
            properties: {
                containerTag: {
                    type: 'string',
                    description: 'Container tag to list documents from.',
                    default: '',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum documents to return (1-1000).',
                    default: 100,
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containerTag: { type: 'string' },
                    total: { type: 'number' },
                    documents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                                status: { type: 'string' },
                                createdAt: { type: 'string' },
                            },
                            required: ['id'],
                        },
                    },
                },
                required: ['containerTag', 'total', 'documents'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containerTag?: string; total?: number; documents?: Array<{ id: string; title?: string }> };
                const lines = (v.documents ?? []).slice(0, 20).map((d, i) => {
                    const t = (d.title || '').replace(/\n/g, ' ').slice(0, 80);
                    return (i + 1) + '. [' + d.id.slice(0, 10) + '] ' + t;
                });
                const more = (v.total ?? 0) > 20 ? '\n... and ' + ((v.total ?? 0) - 20) + ' more' : '';
                return [{ type: 'text', text: 'Documents in "' + v.containerTag + '" (' + v.total + '):\n' + lines.join('\n') + more }];
            },
        },
        execute: async (args) => {
            const a = (args ?? {}) as { containerTag?: unknown; limit?: unknown };
            const tag = argString(a.containerTag, activeContainer(scope));
            const rawLimit = typeof a.limit === 'number' ? a.limit : 100;
            const limit = Math.min(1000, Math.max(1, Math.floor(rawLimit)));
            const { base, apiKey } = requireUpstream(scope);
            const res = await fetch(base + '/v3/documents/list', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ containerTag: tag, limit }),
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) {
                throw new Error('supermemory /v3/documents/list failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
            }
            const data = (await res.json()) as { memories?: Array<{ id: string; title?: string; status?: string; createdAt?: string }> };
            const docs = data.memories ?? [];
            return { containerTag: tag, total: docs.length, documents: docs };
        },
        timeoutMs: 20000,
    };
}

/** Register every AI-facing memory tool into the dsh tool runtime. */
export function registerMemoryTools(ctx: Context, scope: SettingsScope<any>): Array<() => void> {
    return [
        ctx.tools.register(makeSearchTool(scope)),
        ctx.tools.register(makeSaveTool(scope)),
        ctx.tools.register(makeForgetTool(scope)),
        ctx.tools.register(makeDeleteDocumentTool(scope)),
        ctx.tools.register(makeListContainersTool(scope)),
        ctx.tools.register(makeListDocumentsTool(scope)),
    ];
}
