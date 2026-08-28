/**
 * Host loader entry for the Supermemory proxy — orchestration only.
 *
 * Registers one settings namespace ("supermemory": baseUrl + apiKey), a
 * prefix route on dsh's own web server (reverse proxy + health + config +
 * container API), the AI-facing memory tools and the deterministic session
 * hooks (profile injection on session/created, batched turn persistence on
 * turn/end). Implementation lives in the sibling modules:
 *
 *   config.ts          settings schema + config resolution
 *   managed-server.ts  managed local supermemory server process
 *   http.ts            proxy + health + /api routes
 *   containers.ts      container discovery + profile fetch
 *   tools.ts           7 memory tools
 *   hooks.ts           systemPrompt.context() registration + turn persistence
 */
// Type-only imports: they only load the declaration merging into the cordis
// Context (`ctx.webServer` here); erased at compile time, zero runtime cost.
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { Context } from '@deepseek-ai/cordis';
// Type-only merges: ctx.agents (dsh-agent-loop) and ctx.workspaceRegistry.
import type {} from '@deepseek-ai/dsh-agent-loop';
import type {} from '@deepseek-ai/dsh-workspace';
import { registerSupermemorySettings } from './config.ts';
import { ManagedServer } from './managed-server.ts';
import { handleApi, API_PREFIX } from './http.ts';
import { registerMemoryTools } from './tools.ts';
import { registerSessionHooks } from './hooks.ts';

/** Required services: the web route registry, the user-settings seam, the tool registry, and the agent factory (for context injection). */
const inject = ['webServer', 'settings', 'tools', 'agents', 'workspaceRegistry', 'systemPrompt'];

function apply(ctx: Context): void {
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
