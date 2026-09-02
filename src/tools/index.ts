/**
 * Tool registration barrel: imports factory functions from sub-modules
 * and registers them into the dsh tool runtime.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { makeSearchTool, makeSaveTool } from './search.ts';
import { makeForgetTool, makeDeleteDocumentTool } from './crud.ts';
import { makeListContainersTool, makeListDocumentsTool } from './list.ts';
import { makeAuditDocsTool } from './audit.ts';

export { makeSearchTool, makeSaveTool } from './search.ts';
export { makeForgetTool, makeDeleteDocumentTool } from './crud.ts';
export { makeListContainersTool, makeListDocumentsTool } from './list.ts';
export { makeAuditDocsTool } from './audit.ts';

export function registerMemoryTools(ctx: Context, scope: SettingsScope<any>): Array<() => void> {
    return [
        ctx.tools.register(makeSearchTool(scope)),
        ctx.tools.register(makeSaveTool(scope)),
        ctx.tools.register(makeForgetTool(scope)),
        ctx.tools.register(makeDeleteDocumentTool(scope)),
        ctx.tools.register(makeListContainersTool(scope)),
        ctx.tools.register(makeListDocumentsTool(scope)),
        ctx.tools.register(makeAuditDocsTool(scope)),
    ];
}
