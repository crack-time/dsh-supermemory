/**
 * Memory-container concerns: discovery (which container tags exist) and
 * profile retrieval (static + dynamic facts). Used by the settings-card API
 * (GET /containers, POST /config), the memory tools and the session/created
 * injection hook.
 *
 * The authoritative source of truth for tags is /v3/documents/list WITHOUT a
 * containerTag filter (it returns every document's `containerTags` array);
 * the semantic /v4/search endpoint returns 0 hits for broad queries and is
 * NOT a reliable tag-probe. Legacy documents may carry a singular
 * `containerTag` field — handled as a fallback.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
export interface ContainerEntry {
    tag: string;
    staticCount: number;
    dynamicCount: number;
    docCount: number;
}
/** Discover every container present upstream and fetch profile + doc counts. */
export declare function discoverContainers(base: string, apiKey: string, opts?: {
    timeoutMs?: number;
    maxTags?: number;
    defaults?: string[];
}): Promise<ContainerEntry[]>;
/** Fetch the stored profile (static + dynamic facts) for the given container. */
export declare function fetchProfile(scope: SettingsScope<any>, containerTag?: string): Promise<string>;
/** Fetch a tag's raw profile counts (for the select/list tools and card). Never throws. */
export declare function profileCounts(base: string, apiKey: string, tag: string): Promise<{
    staticCount: number;
    dynamicCount: number;
}>;
