/**
 * Managed local supermemory server process, tied to the dsh web plugin
 * lifecycle: spawn on activation, kill on dispose. Never touches a server it
 * did not spawn (an externally-running instance is reported as `external`
 * and left alone — avoids double-writers on the same data dir).
 */
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { resolveConfig, upstreamBase } from './config.ts';
import { probeHealth } from './upstream.ts';

export type ManagedState =
    | 'no-path'       // serverPath empty (waiting for the card)
    | 'external'      // an instance already answers at baseUrl (not ours)
    | 'running'       // our spawned child is alive
    | 'starting'      // spawned, pid not yet bound (transient)
    | 'stopped'       // previously spawned, now stopped/crashed
    | 'missing-exe'   // configured exe path does not exist
    | 'error';        // spawn threw

export interface ManagedSnapshot {
    state: ManagedState;
    pid?: number;
    source?: 'spawned' | 'external';
    exe?: string;
    error?: string;
    stderrTail?: string;
}

export class ManagedServer {
    private child: ChildProcess | undefined;
    private info: ManagedSnapshot = { state: 'no-path' };
    private lastSig = '';

    snapshot(): ManagedSnapshot {
        return { ...this.info };
    }

    private signature(cfg: ReturnType<typeof resolveConfig>): string {
        return [
            cfg.serverPath,
            cfg.openaiBaseUrl,
            cfg.openaiModel,
            cfg.openaiApiKey,
        ].join('|');
    }

    /** Is the configured base URL already reachable (health probe against upstream /v3/settings). */
    private async probe(cfg: ReturnType<typeof resolveConfig>): Promise<boolean> {
        return (await probeHealth(upstreamBase(cfg), cfg.apiKey, 2500)).ok;
    }

    /**
     * Reconcile with current config: shutdown when the path is cleared,
     * (re)start when config/path/model changed, keep running otherwise. Called
     * on activation and after every config save.
     */
    async sync(scope: SettingsScope<any>, ctx: Context): Promise<void> {
        const cfg = resolveConfig(scope);
        if (!cfg.serverPath.trim()) {
            if (this.child && this.child.exitCode === null) await this.stop(ctx);
            this.info = { state: 'no-path' };
            return;
        }
        const sig = this.signature(cfg);
        if (this.child && this.child.exitCode === null) {
            if (this.lastSig === sig) return; // healthy + unchanged
            await this.stop(ctx); // config changed -> restart with new env
            this.lastSig = sig;
            // We just killed our own process: skip the reachability probe (the
            // old listening socket may linger briefly and look "external").
            await this.start(scope, ctx, { skipProbe: true });
        }
        else {
            this.lastSig = sig;
            await this.start(scope, ctx);
        }
    }

    /**
     * Launch the managed process. Skips when already running or when an
     * external instance answers (unless `skipProbe`). Safe to call repeatedly.
     */
    async start(
        scope: SettingsScope<any>,
        ctx: Context,
        opts: { skipProbe?: boolean } = {},
    ): Promise<void> {
        const cfg = resolveConfig(scope);
        if (!cfg.serverPath.trim()) {
            this.info = { state: 'no-path' };
            return;
        }
        if (this.child && this.child.exitCode === null) {
            this.info = { state: 'running', pid: this.child.pid, source: 'spawned' };
            return;
        }
        const exePath = cfg.serverPath.trim();
        try {
            if (!statSync(exePath).isFile()) throw new Error('not a file');
        }
        catch {
            this.info = { state: 'missing-exe', exe: exePath };
            ctx.logger.warn('[supermemory] managed server exe not found: ' + exePath);
            return;
        }
        if (!opts.skipProbe && (await this.probe(cfg))) {
            this.info = { state: 'external', exe: exePath, source: 'external' };
            return;
        }
        try {
            const child = spawn(exePath, [], {
                cwd: dirname(exePath),
                env: {
                    ...process.env,
                    OPENAI_API_KEY: cfg.openaiApiKey,
                    OPENAI_BASE_URL: cfg.openaiBaseUrl,
                    OPENAI_MODEL: cfg.openaiModel,
                },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            this.child = child;
            const onLog = (stream: NodeJS.ReadableStream | null, tag: 'stdout' | 'stderr') => {
                if (!stream) return;
                stream.on('data', (buf: Buffer) => {
                    const line = String(buf).trim();
                    if (!line) return;
                    if (tag === 'stderr') {
                        const tail = (this.info.stderrTail ?? '') + '\n' + line.slice(-400);
                        this.info = { ...this.info, stderrTail: tail.length > 1200 ? tail.slice(-1200) : tail };
                        ctx.logger.debug('[supermemory server] ' + line);
                    }
                    else {
                        ctx.logger.debug('[supermemory server] ' + line);
                    }
                });
            };
            onLog(child.stdout, 'stdout');
            onLog(child.stderr, 'stderr');
            child.on('exit', (code, signal) => {
                if (this.child !== child) return;
                this.child = undefined;
                ctx.logger.info(
                    '[supermemory] managed server exited code=' + code + ' signal=' + String(signal),
                );
                this.info = {
                    state: 'stopped',
                    ...(this.info.pid ? { pid: this.info.pid } : {}),
                    exe: exePath,
                    error: code !== 0 ? 'server exited with code ' + code : undefined,
                };
            });
            child.on('error', (error) => {
                if (this.child !== child) return;
                this.child = undefined;
                this.info = { state: 'error', exe: exePath, error: error.message };
                ctx.logger.warn('[supermemory] managed server spawn error: ' + error.message);
            });
            this.info = {
                state: child.pid ? 'running' : 'starting',
                pid: child.pid ?? undefined,
                source: 'spawned',
                exe: exePath,
            };
            ctx.logger.info('[supermemory] managed server spawned pid=' + child.pid + ' exe=' + exePath);
        }
        catch (error) {
            this.info = {
                state: 'error',
                exe: exePath,
                error: error instanceof Error ? error.message : String(error),
            };
            ctx.logger.warn('[supermemory] managed server spawn:', error);
        }
    }

    /** Kill only the process tree this plugin spawned. Never touches external instances. */
    async stop(ctx: Context): Promise<ManagedSnapshot> {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid) {
            const pid = child.pid;
            try { child.kill(); } catch { /* already dead */ }
            // Windows: guarantee the whole tree dies even if the exe spawned children.
            const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            killer.on('error', () => { /* taskkill may be unavailable — child.kill already ran */ });
            ctx.logger.info('[supermemory] managed server stopping pid=' + pid);
            this.info = {
                state: 'stopped',
                pid,
                exe: this.info.exe,
            };
        }
        else {
            this.info = { ...this.info, state: 'stopped' };
        }
        return this.snapshot();
    }
}
