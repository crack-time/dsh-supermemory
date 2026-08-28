import { activeContainer, argString, requireUpstream } from '../config.js';
/**
 * Memory-forget tool: delete memories from the local Supermemory store —
 * either exact memory ids, or a natural-language query the server matches
 * semantically. dryRun previews before any mutation.
 */
export function makeForgetTool(scope) {
    return {
        name: 'supermemory_forget',
        description: 'Delete or forget memories in the local Supermemory store. Pass exact memory ids, or a natural-language query/topic the server matches semantically; use dryRun to preview first. Use it to clean up wrong, outdated or test memories.',
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
                const v = value;
                const prefix = v.dryRun ? ' (dry run, nothing deleted)' : '';
                return [{ type: 'text', text: 'supermemory_forget' + prefix + ': ' + (v.summary ?? '') + ' (' + (v.count ?? 0) + ' items)' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const ids = Array.isArray(a.ids)
                ? a.ids
                    .filter((x) => typeof x === 'string' && x.trim().length > 0)
                    .map((x) => x.trim())
                : [];
            const query = argString(a.query, '');
            if (ids.length === 0 && !query) {
                throw new Error('supermemory_forget: provide either ids (non-empty array) or query (non-empty string)');
            }
            if (ids.length > 500)
                throw new Error('supermemory_forget: at most 500 ids');
            const tag = argString(a.containerTag, activeContainer(scope));
            const dryRun = a.dryRun === true;
            const rawThreshold = typeof a.threshold === 'number' && Number.isFinite(a.threshold) ? a.threshold : 0.5;
            const threshold = Math.min(1, Math.max(0, rawThreshold));
            const rawMax = typeof a.maxForget === 'number' && Number.isFinite(a.maxForget) ? Math.floor(a.maxForget) : 100;
            const maxForget = Math.min(500, Math.max(1, rawMax));
            const reason = argString(a.reason, '');
            const { base, apiKey } = requireUpstream(scope);
            const body = { containerTag: tag, dryRun, threshold, maxForget };
            if (ids.length > 0)
                body.ids = ids;
            if (query)
                body.query = query;
            if (reason)
                body.reason = reason;
            const res = await fetch(base + '/v4/memories/forget-matching', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: exec.signal,
            });
            if (!res.ok) {
                throw new Error('supermemory /v4/memories/forget-matching failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
            }
            const data = (await res.json());
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
export function makeDeleteDocumentTool(scope) {
    return {
        name: 'supermemory_delete_document',
        description: 'Delete supermemory documents (raw conversation-turn records) by EXPLICIT id(s) only. WARNING: deleting a document CASCADE-deletes the memories it produced. Whitelist-only: you must pass exact document ids; bulk-container deletion is intentionally disabled to prevent accidental loss. Always dryRun first (returns titles for review), then pass confirm:true with id(s) to actually delete.',
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
                const v = value;
                const prefix = v.dryRun ? ' (dry run, nothing deleted)' : '';
                return [{ type: 'text', text: 'supermemory_delete_document' + prefix + ': ' + (v.summary ?? '') + ' (' + (v.deleted ?? 0) + ' documents)' }];
            },
        },
        execute: async (args, exec) => {
            const a = (args ?? {});
            const ids = Array.isArray(a.ids)
                ? a.ids.filter((x) => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
                : [];
            // HARD GUARD: whitelist-only. Bulk-container deletion is disabled.
            if (ids.length === 0)
                throw new Error('supermemory_delete_document: ids (non-empty array) is required — bulk-container deletion is disabled to prevent accidental loss. List exact document ids.');
            if (ids.length > 100)
                throw new Error('supermemory_delete_document: at most 100 ids per call');
            const dryRun = a.dryRun === true;
            const confirm = a.confirm === true;
            const { base, apiKey } = requireUpstream(scope);
            // Build targets (id + resolved title from the list endpoint for review).
            const targets = [];
            // List all documents (no containerTag filter) to resolve titles for any id.
            const listRes = await fetch(base + '/v3/documents/list', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                body: JSON.stringify({ limit: 1000 }),
                signal: exec.signal,
            });
            if (listRes.ok) {
                const listData = (await listRes.json());
                const known = new Map((listData.memories ?? []).map((d) => [d.id, d.title ?? '']));
                for (const id of ids)
                    targets.push({ id, title: known.get(id) ?? '' });
            }
            else {
                for (const id of ids)
                    targets.push({ id, title: '' });
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
                    const d = (await delRes.json());
                    deleted += d.deleted ?? d.deletedDocs ?? batch.length;
                }
                else {
                    for (const id of batch) {
                        const singleRes = await fetch(base + '/v3/documents/' + id, {
                            method: 'DELETE',
                            headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
                            signal: exec.signal,
                        });
                        if (singleRes.ok)
                            deleted++;
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
