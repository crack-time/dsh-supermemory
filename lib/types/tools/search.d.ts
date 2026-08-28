/**
 * Memory search + save tools: semantic recall and entity-centric write.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * supersonic semantic search tool: model-facing recall over the local
 * Supermemory store.
 */
export declare function makeSearchTool(scope: SettingsScope<any>): ToolDefinition;
/**
 * Memory-write tool: persist an entity-centric fact into the local
 * Supermemory store (embeddings generated server-side, immediately
 * searchable).
 */
export declare function makeSaveTool(scope: SettingsScope<any>): ToolDefinition;
