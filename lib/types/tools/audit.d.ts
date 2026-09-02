/**
 * Document audit tool: scan every document in a container, report its
 * processing status, content size and extracted-memory count, and flag
 * likely-low-value documents (empty greetings / self-introductions with no
 * extracted memories) so the model can decide what to clean up.
 *
 * Read-only: never deletes. Cleaning is done with the existing forget /
 * delete tools, so this tool is purely a "visibility + triage" pass.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * supermemory audit tool: enumerate every document in a container and flag
 * low-value / broken candidates. Read-only.
 */
export declare function makeAuditDocsTool(scope: SettingsScope<any>): ToolDefinition;
