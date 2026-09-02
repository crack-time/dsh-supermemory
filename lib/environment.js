/**
 * Dynamic environment context block — rendered at the top of the runtime
 * context so the model immediately knows the host environment.
 *
 * Information sources:
 *   cwd   → session.header.cwd
 *   git   → existsSync(cwd + '/.git')
 *   shell → ctx.shell executor constructor name (PwshLocalExecutor → pwsh),
 *           or the WSL shell when the workspace lives inside a WSL distro
 *   OS    → process.platform + os.release() (or the WSL distro for WSL workspaces)
 *   uv    → probed in well-known locations; for WSL workspaces it is resolved
 *           from the WSL side (fs share + wsl.exe), cached + persisted
 *
 * WSL workspaces are registered by dsh-wsl under a UNC share:
 *   \\wsl.localhost\<distro>\<linux-path>   (legacy: \\wsl$\<distro>\<linux-path>)
 * When the session cwd matches that shape the whole environment block is
 * rendered from the *linux* environment (bash, distro uv/python, Linux kernel)
 * instead of the Windows host values — because from the host's point of view
 * `ctx.shell` is still the pwsh executor, which would be wrong to report.
 *
 * WSL probe architecture (kept deliberately small — one manager, one resolve):
 *   • probeWslFs — synchronous read of the \\wsl.localhost filesystem share
 *     (os-release + uv/python candidate paths). Runs on every render: cheap,
 *     immediate, and gives real data without wsl.exe.
 *   • WslProbeManager — orchestrates the layers. Warm it at session creation
 *     (`ensure`) and pre-warm at plugin activation (`prewarm`); the render
 *     path only ever reads (`resolve`), it never blocks.
 *     Layer precedence in resolve(): fs < persisted < live settled.
 *     The one blocking action — `probeWslSync` (a synchronous wsl.exe call) —
 *     runs at most once per distro per process, and its result is also written
 *     to a persistent cache (~/.dsh/supermemory/wsl-env.json) so later host
 *     starts render from disk on the very first step without re-probing.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release as osRelease, homedir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { WSL_PREFIX_RE, WSL_HOME_RE, isWslWorkspace, distroOf, uncToLinux, isHealthy, probeScript, parseProbe, } from './wsl-env-lib.js';
export { isWslWorkspace, distroOf } from './wsl-env-lib.js';
const execFile = promisify(execFileCb);
// ---------------------------------------------------------------------------
// Sync, non-blocking fs layer — read the WSL filesystem share directly
// ---------------------------------------------------------------------------
/** like existsSync but never throws (denied / unreachable / bad path). */
function anyDir(p) {
    try {
        return existsSync(p);
    }
    catch {
        return false;
    }
}
/** like readFileSync but never throws. */
function readMaybe(p) {
    try {
        return readFileSync(p, 'utf8');
    }
    catch {
        return undefined;
    }
}
/** Derive plausible user home UNC directories for a WSL cwd. */
function wslHomeCandidates(cwd) {
    const homes = new Set();
    const prefix = cwd.match(WSL_PREFIX_RE)?.[1];
    if (!prefix)
        return [];
    const direct = cwd.match(WSL_HOME_RE)?.[1];
    if (direct)
        homes.add(direct);
    const user = cwd.match(/\\home\\([^\\]+)/)?.[1];
    if (user)
        homes.add(`${prefix}\\home\\${user}`);
    if (homes.size === 0)
        homes.add(`${prefix}\\home\\crack`);
    homes.add(`${prefix}\\home\\linuxbrew`); // known linuxbrew prefix
    return [...homes];
}
/** Synchronous best-effort probe read straight off the WSL filesystem share. */
function probeWslFs(cwd) {
    const probe = { distro: distroOf(cwd), shell: 'bash' };
    const prefix = cwd.match(WSL_PREFIX_RE)?.[1];
    if (!prefix)
        return probe;
    const osText = readMaybe(`${prefix}\\etc\\os-release`);
    const m = osText?.match(/^PRETTY_NAME\s*=\s*"?([^"\n]+)"?/m);
    if (m?.[1])
        probe.osName = m[1];
    for (const home of wslHomeCandidates(cwd)) {
        // uv: ~/.local, ~/.cargo, ~/.uv, and the linuxbrew home's .linuxbrew tree
        // (brew installs land under /home/linuxbrew/.linuxbrew/bin).
        for (const rel of ['.local\\bin\\uv', '.cargo\\bin\\uv', '.uv\\bin\\uv', '.linuxbrew\\bin\\uv']) {
            if (anyDir(`${home}\\${rel}`)) {
                probe.uv = uncToLinux(`${home}\\${rel}`);
                break;
            }
        }
        if (probe.uv)
            break;
        for (const rel of ['.local\\bin\\uvx', '.linuxbrew\\bin\\uvx']) {
            if (anyDir(`${home}\\${rel}`)) {
                probe.uvx = uncToLinux(`${home}\\${rel}`);
                break;
            }
        }
    }
    if (!probe.python && anyDir(`${prefix}\\usr\\bin\\python3`))
        probe.python = '/usr/bin/python3';
    return probe;
}
// ---------------------------------------------------------------------------
// WSL wsl.exe probe (marker-line format — survives the Windows→WSL argv edge)
// ---------------------------------------------------------------------------
/** Run one non-interactive bash command inside a distro; resolve with stdout. */
async function wslBash(distro, script) {
    const { stdout } = await execFile('wsl.exe', ['-d', distro, '--', 'bash', '-lc', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
    return stdout;
}
/** Asynchronous probe (used for non-blocking refresh / pre-warm). */
async function probeWsl(distro) {
    try {
        return parseProbe(distro, await wslBash(distro, probeScript()));
    }
    catch {
        return undefined;
    }
}
/** Synchronous probe — blocks the current task up to a few seconds. Caches +
 *  persists on success. Returns the probe or undefined when it fails. */
function probeWslSync(distro) {
    try {
        const out = execFileSync('wsl.exe', ['-d', distro, '--', 'bash', '-lc', probeScript()], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
        const probe = parseProbe(distro, String(out));
        return isHealthy(probe) ? probe : undefined;
    }
    catch (err) {
        log?.(`[supermemory:wsl-env] ${distro}: sync probe failed (${err instanceof Error ? err.message : err})`);
        return undefined;
    }
}
/** Enumerate installed WSL distros (order preserved; defaults first).
 *  wsl.exe writes the listing as UTF-16LE, so sniff the encoding. */
async function listDistros() {
    const { stdout } = await execFile('wsl.exe', ['-l', '-q'], {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 20000,
    });
    const buf = stdout;
    let text;
    if (buf.length >= 2 && (buf.readUInt16LE(0) === 0xfeff || buf.indexOf(0) !== -1)) {
        text = buf.toString('utf16le').replace(/^\uFEFF/, '');
    }
    else {
        text = buf.toString('utf8');
    }
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== '*');
}
// ---------------------------------------------------------------------------
// WslProbeManager — orchestration (single place that owns probe state)
// ---------------------------------------------------------------------------
/** Persistent cache location (also serves as a diagnostics surface). */
const CACHE_DIR = join(homedir(), '.dsh', 'supermemory');
const CACHE_FILE = join(CACHE_DIR, 'wsl-env.json');
/** Optional diagnostics hook (wired from the host apply()). */
let log;
export function setProbeLog(fn) {
    log = fn;
}
class WslProbeManager {
    /** Live healthy probes for this process (by distro). */
    settled = new Map();
    /** Last known-good probes loaded from disk (by distro). */
    persisted = new Map();
    /** Async refreshes in flight (by distro). */
    inflight = new Map();
    /** Distros already given the blocking sync probe this process. */
    syncDone = new Set();
    constructor() {
        try {
            const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
            for (const [distro, probe] of Object.entries(data?.distros ?? {})) {
                if (isHealthy(probe))
                    this.persisted.set(distro, probe);
            }
        }
        catch { /* no cache yet / unreadable */ }
    }
    /** True while an async refresh is running and there is no live data yet. */
    isProbing(distro) {
        return this.inflight.has(distro) && !isHealthy(this.settled.get(distro));
    }
    /**
     * Resolve the best-known probe for a distro. PURE READ — never blocks,
     * never triggers I/O beyond the cheap fs layer. Layer precedence:
     *   fs (synchronous share read) < persisted (disk) < settled (live).
     * Only healthy layers contribute, so a partial probe still improves output.
     */
    resolve(distro, cwd) {
        const layers = [probeWslFs(cwd), this.persisted.get(distro), this.settled.get(distro)]
            .filter((p) => isHealthy(p));
        return Object.assign({}, ...layers);
    }
    /** Write the settled + persisted view to disk (best effort). */
    persist() {
        try {
            mkdirSync(CACHE_DIR, { recursive: true });
            const now = new Date().toISOString();
            const distros = {};
            for (const [distro, probe] of this.settled) {
                if (isHealthy(probe))
                    distros[distro] = { ...probe, updatedAt: now };
            }
            writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: now, distros }, null, 2), 'utf8');
        }
        catch { /* not writable — cache is best-effort only */ }
    }
    /** Non-blocking async refresh: probe in the background, cache on success. */
    refreshAsync(distro) {
        if (this.inflight.has(distro))
            return;
        const job = probeWsl(distro)
            .then((probe) => {
            if (probe && isHealthy(probe)) {
                this.settled.set(distro, probe);
                this.persisted.set(distro, probe);
                this.persist();
                log?.(`[supermemory:wsl-env] ${distro}: ${JSON.stringify({ osName: probe.osName, uv: probe.uv, shell: probe.shell })}`);
            }
        })
            .catch(() => { })
            .finally(() => { this.inflight.delete(distro); });
        this.inflight.set(distro, job);
    }
    /**
     * Warm a distro so a subsequent render has real data. Called during session
     * creation (NOT from the render path). The blocking sync probe runs at most
     * once per distro per process; everything else is non-blocking:
     *   - live data already present → nothing.
     *   - persisted data present → seed it live, then refresh async.
     *   - otherwise → one sync probe (cached + persisted), fall back to refresh.
     */
    ensure(distro) {
        if (!distro)
            return;
        if (isHealthy(this.settled.get(distro)))
            return;
        if (this.syncDone.has(distro)) {
            this.refreshAsync(distro);
            return;
        }
        this.syncDone.add(distro);
        const persisted = this.persisted.get(distro);
        if (persisted && isHealthy(persisted))
            this.settled.set(distro, persisted); // render-ready immediately
        const probe = probeWslSync(distro); // blocking, once per process
        if (probe) {
            this.settled.set(distro, probe);
            this.persisted.set(distro, probe);
            this.persist();
            log?.(`[supermemory:wsl-env] ${distro}: ${JSON.stringify({ osName: probe.osName, uv: probe.uv, shell: probe.shell })}`);
        }
        else {
            this.refreshAsync(distro);
        }
    }
    /** Pre-warm every installed distro (plugin activation, non-blocking). */
    async prewarm() {
        let distros;
        try {
            distros = await listDistros();
        }
        catch {
            return; // wsl.exe unavailable / WSL not installed — fs layer still works
        }
        for (const distro of distros)
            this.refreshAsync(distro);
    }
}
/** Singleton used by the environment block + the session/created hook. */
const wslEnv = new WslProbeManager();
// ---------------------------------------------------------------------------
// Windows-host detection (non-WSL workspaces)
// ---------------------------------------------------------------------------
/** Detect the Python environment by probing well-known uv locations. */
function detectUv() {
    const candidates = [
        join(homedir(), '.local', 'bin', 'uv.exe'), // Windows default
        join(homedir(), '.local', 'bin', 'uv'), // Linux default
        join(homedir(), '.cargo', 'bin', 'uv'), // cargo install
    ];
    for (const p of candidates) {
        if (existsSync(p))
            return 'uv (' + p + ')';
    }
    const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
    for (const dir of pathDirs) {
        const uv = join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv');
        if (existsSync(uv))
            return 'uv (' + uv + ')';
    }
    return undefined;
}
/**
 * Detect the shell tool this DSH web host actually executes commands with.
 * The active shell executor registers as `ctx.shell`; its constructor name
 * tells us which implementation backs it: PwshLocalExecutor -> pwsh,
 * LocalBashExecutor -> bash.
 */
function shellName(ctx) {
    const shell = ctx.shell;
    if (shell) {
        const impl = shell.constructor?.name ?? '';
        if (impl.includes('Pwsh'))
            return 'pwsh';
        if (impl.includes('Bash'))
            return 'bash';
        return impl;
    }
    if (process.env.SHELL?.includes('bash'))
        return 'Git Bash';
    return process.platform === 'win32' ? 'cmd.exe' : 'sh';
}
// ---------------------------------------------------------------------------
// Public helpers (wired from hooks.ts / index.ts)
// ---------------------------------------------------------------------------
/** Kick off – and if needed synchronously resolve – the WSL probe for a session.
 *  Call from session/created so the render path stays non-blocking. */
export function ensureWslProbe(session) {
    const cwd = session.header?.cwd ?? '';
    if (!isWslWorkspace(cwd))
        return;
    wslEnv.ensure(distroOf(cwd));
}
/** Pre-warm every installed distro on plugin activation (non-blocking). */
export async function prewarmWslProbes() {
    await wslEnv.prewarm();
}
// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 * For WSL workspaces it reflects the Linux environment instead of win32.
 * Pure read — no probes are triggered here.
 */
export function environmentBlock(ctx, session) {
    const cwd = session.header?.cwd ?? process.cwd();
    const lines = [
        'Primary working directory: ' + cwd,
        'Is a git repository:      ' + (isGitRepo(cwd) ? 'yes' : 'no'),
    ];
    let uv;
    if (isWslWorkspace(cwd)) {
        const distro = distroOf(cwd);
        const probe = wslEnv.resolve(distro, cwd);
        const probing = wslEnv.isProbing(distro) && !probe.kernel;
        lines.push('Workspace:                WSL (' + distro + ')');
        lines.push('Platform:                 wsl (' + process.platform + ' host)');
        lines.push('Shell:                    ' + (probe.shell || 'bash') + ' (WSL ' + distro + ')');
        const osName = probe.osName || 'Linux';
        lines.push('OS Version:               ' + osName + (probing ? ' (probing…)' : '') + (probe.kernel ? ' (kernel ' + probe.kernel + ')' : ''));
        uv = (probe.uv ? 'uv (' + probe.uv + ')' : undefined)
            ?? (probe.uvx ? 'uvx (' + probe.uvx + ')' : undefined)
            ?? (probe.python ? 'python3 (' + probe.python + ')' : undefined);
    }
    else {
        lines.push('Platform:                 ' + process.platform);
        lines.push('Shell:                    ' + shellName(ctx));
        lines.push('OS Version:               ' + process.platform + ' ' + osRelease());
        uv = detectUv();
    }
    if (uv)
        lines.push('Python:                   ' + uv);
    return lines.join('\n');
}
/** True when the session cwd is inside a git working tree. */
function isGitRepo(cwd) {
    try {
        return existsSync(join(cwd, '.git'));
    }
    catch {
        return false;
    }
}
