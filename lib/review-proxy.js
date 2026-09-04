import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveConfig, upstreamBase } from './config.js';
export class ReviewProxy {
    child;
    info = { state: 'no-path' };
    lastSig = '';
    snapshot() {
        return { ...this.info };
    }
    signature(cfg) {
        return [cfg.reviewProxyPath, cfg.reviewProxyPort].join('|');
    }
    /**
     * Reconcile with current config: stop when the path is cleared, (re)start
     * when path/port changed, keep running otherwise. Called on activation and
     * after every config save.
     */
    async sync(scope, ctx) {
        const cfg = resolveConfig(scope);
        if (!cfg.reviewProxyPath.trim()) {
            if (this.child && this.child.exitCode === null)
                await this.stop(ctx);
            this.info = { state: 'no-path' };
            return;
        }
        const sig = this.signature(cfg);
        if (this.child && this.child.exitCode === null) {
            if (this.lastSig === sig)
                return; // healthy + unchanged
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
    async start(scope, ctx) {
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
            if (!statSync(file).isFile())
                throw new Error('not a file');
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
            child.stdout?.on('data', (buf) => {
                const line = String(buf).trim();
                if (line)
                    ctx.logger.debug('[supermemory review-proxy] ' + line);
            });
            child.stderr?.on('data', (buf) => {
                const line = String(buf).trim();
                if (line)
                    ctx.logger.debug('[supermemory review-proxy] ' + line);
            });
            child.on('exit', (code, signal) => {
                if (this.child !== child)
                    return;
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
                if (this.child !== child)
                    return;
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
    async stop(ctx) {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid) {
            try {
                child.kill();
            }
            catch { /* already dead */ }
            ctx.logger.info('[supermemory] review proxy stopping pid=' + child.pid);
            this.info = { ...this.info, state: 'stopped' };
        }
        else {
            this.info = { ...this.info, state: 'stopped' };
        }
        return this.snapshot();
    }
}
