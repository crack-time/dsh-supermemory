import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveConfig, upstreamBase } from './config.js';
export class ManagedServer {
    child;
    info = { state: 'no-path' };
    lastSig = '';
    snapshot() {
        return { ...this.info };
    }
    signature(cfg) {
        return [
            cfg.serverPath,
            cfg.openaiBaseUrl,
            cfg.openaiModel,
            cfg.openaiApiKey,
        ].join('|');
    }
    /** Is the configured base URL already reachable (health probe against upstream /v3/settings). */
    async probe(cfg) {
        try {
            const res = await fetch(upstreamBase(cfg) + '/v3/settings', {
                headers: { authorization: 'Bearer ' + cfg.apiKey },
                signal: AbortSignal.timeout(2500),
            });
            return res.ok;
        }
        catch {
            // Unreachable/timeout: treat as 'no instance running' so the managed server starts.
            return false;
        }
    }
    /**
     * Reconcile with current config: shutdown when the path is cleared,
     * (re)start when config/path/model changed, keep running otherwise. Called
     * on activation and after every config save.
     */
    async sync(scope, ctx) {
        const cfg = resolveConfig(scope);
        if (!cfg.serverPath.trim()) {
            if (this.child && this.child.exitCode === null)
                await this.stop(ctx);
            this.info = { state: 'no-path' };
            return;
        }
        const sig = this.signature(cfg);
        if (this.child && this.child.exitCode === null) {
            if (this.lastSig === sig)
                return; // healthy + unchanged
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
    async start(scope, ctx, opts = {}) {
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
            if (!statSync(exePath).isFile())
                throw new Error('not a file');
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
            const onLog = (stream, tag) => {
                if (!stream)
                    return;
                stream.on('data', (buf) => {
                    const line = String(buf).trim();
                    if (!line)
                        return;
                    if (tag === 'stderr') {
                        this.info = { ...this.info, stderrTail: (this.info.stderrTail ?? '') + '\n' + line.slice(-400) };
                        if ((this.info.stderrTail?.length ?? 0) > 1200) {
                            this.info.stderrTail = this.info.stderrTail.slice(-1200);
                        }
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
                if (this.child !== child)
                    return;
                this.child = undefined;
                ctx.logger.info('[supermemory] managed server exited code=' + code + ' signal=' + String(signal));
                this.info = {
                    state: 'stopped',
                    ...(this.info.pid ? { pid: this.info.pid } : {}),
                    exe: exePath,
                    error: code !== 0 ? 'server exited with code ' + code : undefined,
                };
            });
            child.on('error', (error) => {
                if (this.child !== child)
                    return;
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
    async stop(ctx) {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid) {
            const pid = child.pid;
            try {
                child.kill();
            }
            catch { /* already dead */ }
            // Windows: guarantee the whole tree dies even if the exe spawned children.
            const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            killer.on('error', () => { });
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
