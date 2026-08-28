/**
 * List tools: container discovery and document listing.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/**
 * List-containers tool: show all memory spaces with their fact counts.
 */
export declare function makeListContainersTool(scope: SettingsScope<any>): ToolDefinition;
/**
 * List-documents tool: show documents in a memory space.
 */
export declare function makeListDocumentsTool(scope: SettingsScope<any>): ToolDefinition;
/** Register every AI-facing memory tool into the dsh tool runtime. */ 
