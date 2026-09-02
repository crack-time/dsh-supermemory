/**
 * Memory forget + delete tools.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, argString, requireUpstream } from '../config.ts';
import { apiFetch, docInContainer, listDocumentPages } from '../upstream.ts';

/**
 * Memory-forget tool: delete memories from the local Supermemory store —
 * either exact memory ids, or a natural-language query the server matches
 * semantically. dryRun previews before any mutation.
 */
export function makeForgetTool(scope: SettingsScope<any>): ToolDefinition {
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
            const data = await apiFetch<{
                dryRun?: boolean; count?: number; forgetBatchId?: string | null; summary?: string;
            }>(base, apiKey, '/v4/memories/forget-matching', {
                method: 'POST',
                body,
                signal: exec.signal,
            });
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

interface MemoryEntry {
    id: string;
    memory?: string;
    documentIds?: string[];
}

/**
 * Delete-document tool: remove supermemory documents (raw conversation-turn
 * records) by exact id(s). Deleting a document CASCADE-deletes the memories it
 * produced — the user accepts this by default. Guarded: dryRun previews and
 * confirm:true is required to actually delete.
 */
export function makeDeleteDocumentTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_delete_document',
        description:
            'Delete supermemory documents AND their produced memories. ' +
            'Accepts either explicit document ids (ids) OR a session id (sessionId) to delete all documents from that session. ' +
            'Always dryRun first to preview, then pass confirm:true to actually delete.',
        parameters: {
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Document ids to delete (max 100). Provide either ids or sessionId, not both.',
                },
                sessionId: {
                    type: 'string',
                    description: 'Delete all documents and memories from this DSH session id (e.g. "session-3d6f0736-..."). Provide either ids or sessionId, not both.',
                },
                containerTag: {
                    type: 'string',
                    description: 'Optional: scope the search to a specific container when using sessionId.',
                    default: '',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'When true, only preview which documents WOULD be deleted.',
                    default: true,
                },
                confirm: {
                    type: 'boolean',
                    description: 'Required to actually delete. Must be true to perform the deletion.',
                    default: false,
                },
            },
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
            const a = (args ?? {}) as { ids?: unknown; sessionId?: unknown; containerTag?: unknown; dryRun?: unknown; confirm?: unknown };
            const requestedIds = Array.isArray(a.ids)
                ? a.ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
                : [];
            const sessionId = typeof a.sessionId === 'string' ? a.sessionId.trim() : '';
            if (requestedIds.length === 0 && !sessionId) {
                throw new Error('supermemory_delete_document: provide either ids (non-empty array) or sessionId (non-empty string).');
            }
            if (requestedIds.length > 0 && sessionId) {
                throw new Error('supermemory_delete_document: provide either ids or sessionId, not both.');
            }
            if (requestedIds.length > 100) throw new Error('supermemory_delete_document: at most 100 ids per call');
            const dryRun = a.dryRun === true;
            const confirm = a.confirm === true;
            const { base, apiKey } = requireUpstream(scope);
            const tag = argString(a.containerTag, activeContainer(scope));

            // If sessionId provided, resolve it → document IDs by scanning v3 documents list.
            let docIds = requestedIds;
            if (sessionId) {
                const resolved: string[] = [];
                await listDocumentPages(base, apiKey, { limit: 200, maxPages: 20, signal: exec.signal }, (docs) => {
                    for (const d of docs) {
                        if (d.metadata?.sessionId !== sessionId) continue;
                        if (tag && !docInContainer(d, tag)) continue;
                        resolved.push(d.id);
                    }
                });
                docIds = resolved;
            }

            // Resolve document IDs → titles (via v3 documents) and document IDs →
            // memory IDs (via v4 memories list) so we can preview and cascade the
            // side effects.
            const docIdSet = new Set(docIds);
            const titleMap = new Map<string, string>();
            const docToMemIds = new Map<string, string[]>();

            await listDocumentPages(base, apiKey, { limit: 200, maxPages: 10, signal: exec.signal }, (docs) => {
                for (const d of docs) {
                    if (docIdSet.has(d.id)) titleMap.set(d.id, (d.title ?? '').slice(0, 80));
                }
            });

            let page = 1;
            let totalPages = 1;
            do {
                const data = await apiFetch<{
                    memoryEntries?: MemoryEntry[];
                    pagination?: { currentPage?: number; totalPages?: number };
                }>(base, apiKey, '/v4/memories/list', {
                    method: 'POST',
                    body: { containerTags: [tag], limit: 100, page },
                    signal: exec.signal,
                });
                for (const e of data.memoryEntries ?? []) {
                    for (const dId of e.documentIds ?? []) {
                        if (!docIdSet.has(dId)) continue;
                        const arr = docToMemIds.get(dId) ?? [];
                        arr.push(e.id);
                        docToMemIds.set(dId, arr);
                        if (!titleMap.has(dId)) titleMap.set(dId, (e.memory ?? '').slice(0, 80));
                    }
                }
                totalPages = data.pagination?.totalPages ?? 1;
                page = (data.pagination?.currentPage ?? page) + 1;
            } while (page <= totalPages && page <= 20);

            const targets = docIds.map((id) => ({ id, title: titleMap.get(id) ?? '' }));

            if (dryRun) {
                const memCount = [...docToMemIds.values()].reduce((s, arr) => s + arr.length, 0);
                return {
                    dryRun: true,
                    deleted: 0,
                    summary: 'Dry run: ' + targets.length + ' document(s) found, linked to ' + memCount + ' memory entry(ies). Pass confirm:true to delete.',
                    documents: targets,
                };
            }

            if (!confirm) {
                throw new Error('supermemory_delete_document: confirm:true is required — this deletes both memories and documents. Re-check with dryRun first.');
            }

            // Step 2: Forget linked memories via /v4/memories/forget-matching.
            const allMemIds: string[] = [];
            for (const memIds of docToMemIds.values()) allMemIds.push(...memIds);
            let memForgotten = 0;
            for (let i = 0; i < allMemIds.length; i += 100) {
                const batch = allMemIds.slice(i, i + 100);
                try {
                    const d = await apiFetch<{ count?: number }>(base, apiKey, '/v4/memories/forget-matching', {
                        method: 'POST',
                        body: { containerTag: tag, dryRun: false, threshold: 0, maxForget: batch.length, ids: batch },
                        signal: exec.signal,
                    });
                    memForgotten += d.count ?? 0;
                }
                catch { /* batch failed — keep going, deletion is best-effort */ }
            }

            // Step 3: Delete v3 documents via /v3/documents/bulk DELETE with JSON body.
            let docsDeleted = 0;
            for (let i = 0; i < docIds.length; i += 100) {
                const batch = docIds.slice(i, i + 100);
                try {
                    const d = await apiFetch<{ deletedCount?: number }>(base, apiKey, '/v3/documents/bulk', {
                        method: 'DELETE',
                        body: { ids: batch },
                        signal: exec.signal,
                    });
                    docsDeleted += d.deletedCount ?? 0;
                }
                catch { /* batch failed — keep going */ }
            }

            return {
                dryRun: false,
                deleted: memForgotten + docsDeleted,
                summary: 'Forgotten ' + memForgotten + ' memories, deleted ' + docsDeleted + ' documents (' + targets.length + ' document(s) targeted).',
                documents: targets,
            };
        },
        timeoutMs: 120000,
    };
}