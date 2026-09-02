/**
 * List tools: container discovery and document listing.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { activeContainer, argString, requireUpstream } from '../config.ts';
import { discoverContainers } from '../containers.ts';
import { docInContainer, listDocumentPages } from '../upstream.ts';

/**
 * List-containers tool: show all memory spaces with their fact counts.
 */
export function makeListContainersTool(scope: SettingsScope<any>): ToolDefinition {
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
export function makeListDocumentsTool(scope: SettingsScope<any>): ToolDefinition {
    return {
        name: 'supermemory_list_documents',
        description: 'List documents stored in a specific memory space (container tag). Returns document ids, titles, and metadata. Paginates over ALL pages server-side so total is the container\'s real document count (the upstream list endpoint ignores the container filter, so filtering happens here). Use this to review what is stored before deleting or managing documents. Use offset to page through large result sets.',
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
                    description: 'Page size for the upstream pagination (1-1100). This is a per-page cap, not a total cap — the tool pages through everything.',
                    default: 100,
                },
                offset: {
                    type: 'number',
                    description: 'Number of documents to skip from the start. Use for pagination when the total exceeds the display limit.',
                    default: 0,
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    containerTag: { type: 'string' },
                    total: { type: 'number' },
                    offset: { type: 'number' },
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
                required: ['containerTag', 'total', 'offset', 'documents'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value as { containerTag?: string; total?: number; offset?: number; documents?: Array<{ id: string; title?: string }> };
                const offset = v.offset ?? 0;
                const docs = v.documents ?? [];
                const lines = docs.map((d, i) => {
                    const t = (d.title || '').replace(/\n/g, ' ').slice(0, 80);
                    return (offset + i + 1) + '. [' + d.id + '] ' + t;
                });
                const end = offset + docs.length;
                const total = v.total ?? 0;
                const hasMore = end < total;
                const rangeInfo = '[' + (offset + 1) + '-' + end + ' of ' + total + ']';
                const hint = hasMore ? '\nUse offset=' + end + ' to see more.' : '';
                return [{ type: 'text', text: 'Documents in "' + v.containerTag + '" ' + rangeInfo + ':\n' + lines.join('\n') + hint }];
            },
        },
        execute: async (args) => {
            const a = (args ?? {}) as { containerTag?: unknown; limit?: unknown; offset?: unknown };
            const tag = argString(a.containerTag, activeContainer(scope));
            const rawLimit = typeof a.limit === 'number' ? a.limit : 100;
            const offset = typeof a.offset === 'number' ? Math.max(0, Math.floor(a.offset)) : 0;
            // Upstream limit is capped at 1100 (server rejects anything larger).
            const limit = Math.min(1100, Math.max(1, Math.floor(rawLimit)));
            const { base, apiKey } = requireUpstream(scope);

            // The upstream /v3/documents/list IGNORES containerTag and returns
            // documents across every container (pagination.totalItems is global),
            // so we walk ALL pages and filter by the container's own tags field.
            // A page cap keeps runaway cases bounded.
            const all: Array<{ id: string; title?: string; status?: string; createdAt?: string }> = [];
            await listDocumentPages(base, apiKey, { limit, maxPages: 20, timeoutMs: 15000 }, (docs) => {
                for (const d of docs) {
                    if (docInContainer(d, tag)) {
                        all.push({ id: d.id, title: d.title, status: d.status, createdAt: d.createdAt });
                    }
                }
            });

            // Apply client-side offset/limit for the window view.
            const windowDocs = all.slice(offset, offset + limit);

            return { containerTag: tag, total: all.length, offset, documents: windowDocs };
        },
        timeoutMs: 60000,
    };
}

/** Register every AI-facing memory tool into the dsh tool runtime. */