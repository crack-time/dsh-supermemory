/**
 * Managed review-proxy process, lifecycle-tied to the dsh web plugin the same
 * way ManagedServer manages the supermemory server: spawned on activation,
 * killed on dispose, restarted when its config changes.
 *
 * The self-hosted supermemory dashboard (localhost:6767) ships its HTML
 * embedded in the compiled binary, so it cannot host extra tabs in place.
 * ReviewProxy spawns the small `supermemory-review-proxy` (a reverse proxy that
 * injects a "Review" tab into the dashboard and keeps the apiKey server-side),
 * forwarding base URL / port / apiKey via environment so the standalone project
 * doesn't need to re-read them. Empty `reviewProxyPath` disables it.
 */
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { resolveConfig, upstreamBase } from './config.ts';

export type ReviewProxyState =
    | 'no-path'       // reviewProxyPath empty (waiting for the settings card)
    | 'running'       // our spawned child is alive
    | 'starting'      // spawned, pid not yet cofirmed (transient)
    | 'stopped'       // previously spawned, now stopped/crashed
    | 'missing-file'  // configured proxy.mjs path does not exist
    | 'error';        // spawn threw

export interface ReviewProxySnapshot {
    state: ReviewProxyState;
    pid?: number;
    file?: string;
    port?: number;
    error?: string;
}

export class ReviewProxy {
    private child: ChildProcess | undefined;
    private info: ReviewProxySnapshot = { state: 'no-path' };
    private lastSig = '';

    snapshot(): ReviewProxySnapshot {
        return { ...this.info };
    }

    private signature(cfg: ReturnType<typeof resolveConfig>): string {
        return [cfg.reviewProxyPath, cfg.reviewProxyPort].join('|');
    }

    /**
     * Reconcile with current config: stop when the path is cleared, (re)start
     * when path/port changed, keep running otherwise. Called on activation and
     * after every config save.
     */
    async sync(scope: SettingsScope<any>, ctx: Context): Promise<void> {
        const cfg = resolveConfig(scope);
        if (!cfg.reviewProxyPath.trim()) {
            if (this.child && this.child.exitCode === null) await this.stop(ctx);
            this.info = { state: 'no-path' };
            return;
        }
        const sig = this.signature(cfg);
        if (this.child && this.child.exitCode === null) {
            if (this.lastSig === sig) return; // healthy + unchanged
            await this.stop(ctx);
            this.lastSig = sig;
            await this.start(scope, ctx);
        }
        else {
            this.lastSig = sig;
            await this.start(scope, ctx);
        }
    }

    /** Launch the review-proxy child. Safe to call repeatedly. */
    async start(
        scope: SettingsScope<any>,
        ctx: Context,
    ): Promise<void> {
        const cfg = resolveConfig(scope);
        const file = cfg.reviewProxyPath.trim();
        if (!file) {
            this.info = { state: 'no-path' };
            return;
        }
        if (this.child && this.child.exitCode === null) {
            this.info = { state: 'running', pid: this.child.pid, file, port: cfg.reviewProxyPort };
            return;
        }
        try {
            if (!statSync(file).isFile()) throw new Error('not a file');
        }
        catch {
            this.info = { state: 'missing-file', file };
            ctx.logger.warn('[supermemory] review proxy file not found: ' + file);
            return;
        }
        try {
            const child = spawn(process.execPath, [file], {
                cwd: dirname(file),
                env: {
                    ...process.env,
                    SM_PROXY_PORT: String(cfg.reviewProxyPort),
                    SM_BASE: upstreamBase(cfg),
                    SM_API_KEY: cfg.apiKey,
                },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            this.child = child;
            child.stdout?.on('data', (buf: Buffer) => {
                const line = String(buf).trim();
                if (line) ctx.logger.debug('[supermemory review-proxy] ' + line);
            });
            child.stderr?.on('data', (buf: Buffer) => {
                const line = String(buf).trim();
                if (line) ctx.logger.debug('[supermemory review-proxy] ' + line);
            });
            child.on('exit', (code, signal) => {
                if (this.child !== child) return;
                this.child = undefined;
                ctx.logger.info('[supermemory] review proxy exited code=' + code + ' signal=' + String(signal));
                this.info = {
                    state: 'stopped',
                    ...(this.info.pid ? { pid: this.info.pid } : {}),
                    file,
                    port: cfg.reviewProxyPort,
                    error: code !== 0 ? 'review proxy exited with code ' + code : undefined,
                };
            });
            child.on('error', (error) => {
                if (this.child !== child) return;
                this.child = undefined;
                this.info = { state: 'error', file, port: cfg.reviewProxyPort, error: error.message };
                ctx.logger.warn('[supermemory] review proxy spawn error: ' + error.message);
            });
            this.info = {
                state: child.pid ? 'running' : 'starting',
                pid: child.pid ?? undefined,
                file,
                port: cfg.reviewProxyPort,
            };
            ctx.logger.info('[supermemory] review proxy spawned pid=' + child.pid + ' file=' + file + ' port=' + cfg.reviewProxyPort);
        }
        catch (error) {
            this.info = {
                state: 'error',
                file,
                port: cfg.reviewProxyPort,
                error: error instanceof Error ? error.message : String(error),
            };
            ctx.logger.warn('[supermemory] review proxy spawn:', error);
        }
    }

    /** Kill only the process this plugin spawned. */
    async stop(ctx: Context): Promise<ReviewProxySnapshot> {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid) {
            try { child.kill(); } catch { /* already dead */ }
            ctx.logger.info('[supermemory] review proxy stopping pid=' + child.pid);
            this.info = { ...this.info, state: 'stopped' };
        }
        else {
            this.info = { ...this.info, state: 'stopped' };
        }
        return this.snapshot();
    }
}