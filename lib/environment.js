/**
 * Dynamic environment context block — rendered at the top of the runtime
 * context so the model immediately knows the host environment.
 *
 * Information sources:
 *   cwd   → session.header.cwd
 *   git   → existsSync(cwd + '/.git')
 *   shell → ctx.shell executor constructor name (PwshLocalExecutor → pwsh)
 *   OS    → process.platform + os.release()
 *   uv    → existsSync candidates in well-known paths
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { release as osRelease, homedir } from 'node:os';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** True when the session cwd is inside a git working tree. */
function isGitRepo(cwd) {
    try {
        return existsSync(join(cwd, '.git'));
    }
    catch {
        return false;
    }
}
/**
 * Detect the shell tool this DSH web host actually executes commands with.
 * The active shell executor registers as `ctx.shell` (one per context);
 * its constructor name tells us which implementation backs it:
 * PwshLocalExecutor -> pwsh, LocalBashExecutor -> bash.
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
/**
 * Detect the Python environment by probing well-known uv locations.
 * Returns a descriptive string or undefined if uv is not installed.
 */
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
    // PATH-based check: if process.env.PATH contains a dir with uv, note it.
    const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
    for (const dir of pathDirs) {
        const uv = join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv');
        if (existsSync(uv))
            return 'uv (' + uv + ')';
    }
    return undefined;
}
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 */
export function environmentBlock(ctx, session) {
    const cwd = session.header?.cwd ?? process.cwd();
    const lines = [
        'Primary working directory: ' + cwd,
        'Is a git repository:      ' + (isGitRepo(cwd) ? 'yes' : 'no'),
        'Platform:                 ' + process.platform,
        'Shell:                    ' + shellName(ctx),
        'OS Version:               ' + process.platform + ' ' + osRelease(),
    ];
    const uv = detectUv();
    if (uv)
        lines.push('Python:                   ' + uv);
    return lines.join('\n');
}
