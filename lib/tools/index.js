import { makeSearchTool, makeSaveTool } from './search.js';
import { makeForgetTool, makeDeleteDocumentTool } from './crud.js';
import { makeListContainersTool, makeListDocumentsTool } from './list.js';
export { makeSearchTool, makeSaveTool } from './search.js';
export { makeForgetTool, makeDeleteDocumentTool } from './crud.js';
export { makeListContainersTool, makeListDocumentsTool } from './list.js';
export function registerMemoryTools(ctx, scope) {
    return [
        ctx.tools.register(makeSearchTool(scope)),
        ctx.tools.register(makeSaveTool(scope)),
        ctx.tools.register(makeForgetTool(scope)),
        ctx.tools.register(makeDeleteDocumentTool(scope)),
        ctx.tools.register(makeListContainersTool(scope)),
        ctx.tools.register(makeListDocumentsTool(scope)),
    ];
}
