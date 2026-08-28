import { registerSupermemorySettings } from './config.js';
import { ManagedServer } from './managed-server.js';
import { handleApi, API_PREFIX } from './http.js';
import { registerMemoryTools } from './tools/index.js';
import { registerSessionHooks } from './hooks.js';
/** Required services: the web route registry, the user-settings seam, the tool registry, and the agent factory (for context injection). */
const inject = ['webServer', 'settings', 'tools', 'agents', 'workspaceRegistry', 'systemPrompt', 'shell'];
function apply(ctx) {
    // "supermemory" settings namespace: dsh rc.7 renders it as a settings card
    // (the client half registers the slot entry); `applies: 'live'` means card
    // edits reach the proxy immediately via settings/document-updated.
    const scope = registerSupermemorySettings(ctx);
    // Managed local server: spawn alongside dsh web, kill on dispose.
    const managed = new ManagedServer();
    ctx.effect(() => {
        // Start (or adopt) the managed server when this plugin activates —
        // i.e. when dsh web boots and loads the plugin.
        void managed.sync(scope, ctx);
        const disposers = [
            ctx.webServer.register({
                kind: 'prefix',
                path: API_PREFIX,
                handler: (req, res) => handleApi(ctx, scope, req, res, managed),
            }),
            ...registerMemoryTools(ctx, scope),
            ...registerSessionHooks(ctx, scope),
        ];
        return () => {
            // dsh web is stopping: tear down the managed server process tree.
            void managed.stop(ctx);
            disposers.forEach((dispose) => dispose());
        };
    }, 'dsh-supermemory: proxy + health + config + memory tools');
}
export { apply, inject };
