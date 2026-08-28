/**
 * Memory forget + delete tools.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * Memory-forget tool: delete memories from the local Supermemory store —
 * either exact memory ids, or a natural-language query the server matches
 * semantically. dryRun previews before any mutation.
 */
export declare function makeForgetTool(scope: SettingsScope<any>): ToolDefinition;
/**
 * Delete-document tool: remove supermemory documents (raw conversation-turn
 * records) by exact id(s). Deleting a document CASCADE-deletes the memories it
 * produced — the user accepts this by default. Guarded: dryRun previews and
 * confirm:true is required to actually delete.
 */
export declare function makeDeleteDocumentTool(scope: SettingsScope<any>): ToolDefinition;
