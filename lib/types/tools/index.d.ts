/**
 * Tool registration barrel: imports factory functions from sub-modules
 * and registers them into the dsh tool runtime.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
export { makeSearchTool, makeSaveTool } from './search.ts';
export { makeForgetTool, makeDeleteDocumentTool } from './crud.ts';
export { makeListContainersTool, makeListDocumentsTool } from './list.ts';
export { makeAuditDocsTool } from './audit.ts';
export declare function registerMemoryTools(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
