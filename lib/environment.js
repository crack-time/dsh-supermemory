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
 *   uv    → probed in well-known locations; for WSL workspaces it is
 *           resolved inside the distro with `command -v uv` (async, cached)
 *
 * WSL workspaces are registered by dsh-wsl under a UNC share:
 *   \\wsl.localhost\<distro>\<linux-path>   (legacy: \\wsl$\<distro>\<linux-path>)
 * When the session cwd matches that shape the whole environment block is
 * rendered from the *linux* environment (bash, distro uv/python, Linux kernel)
 * instead of the Windows host values — because from the host's point of view
 * `ctx.shell` is still the pwsh executor, which would be wrong to report.
 *
 * Immediacy: `prewarmWslProbes()` enumerates every installed distro and starts
 * probing them as soon as the plugin activates, so by the time a WSL session
 * first renders its environment block the probe is usually already settled.
 * `kickOffEnvironmentProbe()` additionally primes the session's own distro.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { release as osRelease, homedir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCb);
// ---------------------------------------------------------------------------
// WSL workspace detection
// ---------------------------------------------------------------------------
/** Match \\wsl.localhost\<distro>\... or the legacy \\wsl$\<distro>\... */
const WSL_ROOT_RE = /^\\\\wsl(?:\.localhost)?\$?\\/i;
/** Capture the distro name from a WSL UNC path. */
const WSL_DISTRO_RE = /^\\\\wsl(?:\.localhost)?\$?\\([^\\]+)/i;
/** Capture the \\wsl(<.localhost>)<\distro> prefix for building child paths. */
const WSL_PREFIX_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+)/i;
/** Capture …\home\<user> inside a WSL UNC path. */
const WSL_HOME_RE = /^(\\\\wsl(?:\.localhost)?\$?\\[^\\]+\\home\\[^\\]+)/i;
/** True when a (Windows-host) cwd points inside a WSL distro share. */
export function isWslWorkspace(cwd) {
    return WSL_ROOT_RE.test(cwd);
}
/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export function distroOf(cwd) {
    return cwd.match(WSL_DISTRO_RE)?.[1] ?? '';
}
/** Settled probes (by distro); only ever written after a probe settles. */
const wslSettled = new Map();
/** In-flight probes (by distro) so concurrent sessions share one wsl.exe call. */
const wslInFlight = new Map();
/** Run one non-interactive bash command inside a distro and resolve with stdout. */
async function wslBash(distro, script) {
    const { stdout } = await execFile('wsl.exe', ['-d', distro, '--', 'bash', '-lc', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
    return stdout;
}
/** Enumerate installed WSL distros (order preserved; defaults first).
 *  wsl.exe writes the listing as UTF-16LE, so sniff the encoding. */
async function listDistros() {
    const { stdout } = await execFile('wsl.exe', ['-l', '-q'], {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 15000,
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
/**
 * Probe one distro for its shell + toolchain. The bash one-liner first widens
 * PATH with every well-known tool directory (so a non-interactive shell — which
 * skips .bashrc's interactive guard — still finds brew/uv/cargo installs), then
 * reports uv/uvx/python by `command -v`, falling back to exists on those same
 * directories for uv if it isn't on PATH.
 */
async function probeWsl(distro) {
    const script = [
        ': "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"',
        'printf "__USER__=%s\\n" "$(id -un 2>/dev/null)"',
        'printf "__HOME__=%s\\n" "$HOME"',
        'printf "__SHELL__=%s\\n" "${SHELL:-/bin/bash}"',
        'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"',
        'u=$(command -v uv 2>/dev/null); [ -z "$u" ] && for p in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv" "/home/linuxbrew/.linuxbrew/bin/uv"; do [ -x "$p" ] && u="$p" && break; done; printf "__UV__=%s\\n" "$u"',
        'x=$(command -v uvx 2>/dev/null); [ -z "$x" ] && for p in "$HOME/.local/bin/uvx" "$HOME/.cargo/bin/uvx" "/home/linuxbrew/.linuxbrew/bin/uvx"; do [ -x "$p" ] && x="$p" && break; done; printf "__UVX__=%s\\n" "$x"',
        'printf "__PY__=%s\\n" "$(command -v python3 2>/dev/null)"',
        'printf "__PY2__=%s\\n" "$(command -v python 2>/dev/null)"',
        '. /etc/os-release 2>/dev/null && printf "__OSNAME__=%s\\n" "${PRETTY_NAME:-unknown}"',
        'printf "__KERNEL__=%s\\n" "$(uname -r 2>/dev/null)"',
    ].join('\n');
    const out = await wslBash(distro, script);
    const probe = { distro, shell: 'bash' };
    for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^__([A-Z0-9_]+)__=(.*)$/);
        if (!m)
            continue;
        const raw = m[1].toLowerCase();
        if (raw === 'distro')
            continue;
        const value = (m[2] ?? '').trim();
        if (!value)
            continue;
        // `python` (__PY2__) is folded into the python slot when python3 is absent.
        if (raw === 'py2') {
            if (!probe.python)
                probe.python = value;
            continue;
        }
        if (raw in probe)
            probe[raw] = value;
    }
    if (probe.shell.includes('/'))
        probe.shell = probe.shell.split('/').pop() ?? probe.shell;
    return probe;
}
/** Fire-and-forget a probe for one distro into the settled cache. */
function startProbe(distro) {
    if (!distro || wslInFlight.has(distro) || wslSettled.has(distro))
        return;
    const promise = probeWsl(distro)
        .then((probe) => {
        wslSettled.set(distro, probe);
        return probe;
    })
        .catch(() => {
        const fallback = { distro, shell: 'bash' };
        wslSettled.set(distro, fallback);
        return fallback;
    });
    wslInFlight.set(distro, promise);
}
/**
 * Pre-warm every installed distro on plugin activation so WSL environment
 * blocks render from settled data (not the placeholder) on the first model
 * step of a WSL session. No-op when WSL is unavailable or distros are gone.
 */
export async function prewarmWslProbes() {
    let distros;
    try {
        distros = await listDistros();
    }
    catch {
        return; // wsl.exe unavailable / WSL not installed — nothing to warm
    }
    for (const distro of distros)
        startProbe(distro);
}
/**
 * Kick off the WSL probe for a session (fire-and-forget, once per distro).
 * Safe to call for every session — no-ops otherwise. Resolves into `wslSettled`
 * so the synchronous environment renderer can read it without awaiting.
 */
export function kickOffEnvironmentProbe(session) {
    const cwd = session.header?.cwd ?? '';
    if (!isWslWorkspace(cwd))
        return;
    startProbe(distroOf(cwd));
}
/** Settled probe for a WSL cwd, or undefined when not probed yet. */
function settledProbe(cwd) {
    if (!isWslWorkspace(cwd))
        return undefined;
    return wslSettled.get(distroOf(cwd));
}
// ---------------------------------------------------------------------------
// Sync fallbacks (used before the async probe settles, or when wsl.exe fails)
// ---------------------------------------------------------------------------
/** Best-effort uv location reached over the WSL filesystem share (no wsl.exe). */
function detectUvWslFs(cwd) {
    const prefix = cwd.match(WSL_PREFIX_RE)?.[1]; // e.g. \\wsl.localhost\Ubuntu
    if (!prefix)
        return undefined;
    const homes = new Set();
    // Real home derived from the cwd (…\home\<user>\) or, failing that, every
    // reasonable user home under /home + the linuxbrew prefix.
    const direct = cwd.match(WSL_HOME_RE)?.[1];
    if (direct)
        homes.add(direct);
    const maybeUser = cwd.match(/\\home\\([^\\]+)/)?.[1];
    if (maybeUser)
        homes.add(`${prefix}\\home\\${maybeUser}`);
    if (homes.size === 0)
        homes.add(`${prefix}\\home\\crack`);
    homes.add(`${prefix}\\home\\linuxbrew`);
    for (const h of homes) {
        for (const rel of ['.local\\bin\\uv', '.cargo\\bin\\uv', '.uv\\bin\\uv', '.local\\bin\\uvx']) {
            try {
                if (existsSync(`${h}\\${rel}`))
                    return 'uv (' + h + '\\' + rel + ')';
            }
            catch { /* skip */ }
        }
    }
    return undefined;
}
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
// Render
// ---------------------------------------------------------------------------
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 * For WSL workspaces it reflects the Linux environment instead of win32.
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
        const probe = settledProbe(cwd);
        const shell = probe?.shell || 'bash';
        const osName = probe?.osName || 'Linux';
        const kernel = probe?.kernel;
        lines.push('Workspace:                WSL (' + distro + ')');
        lines.push('Platform:                 wsl (' + process.platform + ' host)');
        lines.push('Shell:                    ' + shell + ' (WSL ' + distro + ')');
        lines.push('OS Version:               ' + osName + (kernel ? ' (kernel ' + kernel + ')' : ''));
        uv = (probe?.uv ? 'uv (' + probe.uv + ')' : undefined)
            ?? (probe?.uvx ? 'uvx (' + probe.uvx + ')' : undefined)
            ?? (probe?.python ? 'python3 (' + probe.python + ')' : undefined)
            ?? detectUvWslFs(cwd);
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
