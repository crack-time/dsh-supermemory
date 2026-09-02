import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
/** True when a (Windows-host) cwd points inside a WSL distro share. */
export declare function isWslWorkspace(cwd: string): boolean;
/** Extract the distro name from a WSL UNC cwd ('' when not a WSL path). */
export declare function distroOf(cwd: string): string;
/** What we know about a WSL distro's toolchain. */
export interface WslProbe {
    distro: string;
    /** Linux username (uid 0-owner). */
    user?: string;
    /** Linux home directory, e.g. /home/crack. */
    home?: string;
    /** $SHELL basename inside the distro, e.g. bash. */
    shell: string;
    /** `command -v uv` result (or a well-known fallback), e.g. /home/linuxbrew/.linuxbrew/bin/uv. */
    uv?: string;
    /** `command -v uvx` result. */
    uvx?: string;
    /** `command -v python3` result. */
    python?: string;
    /** distro pretty name, e.g. "Ubuntu 22.04.5 LTS". */
    osName?: string;
    /** Linux kernel release, e.g. 5.15.153.1-microsoft-standard-WSL2. */
    kernel?: string;
}
export declare function setProbeLog(fn?: (m: string) => void): void;
/** Kick off – and if needed synchronously resolve – the WSL probe for a session.
 *  Call from session/created so the render path stays non-blocking. */
export declare function ensureWslProbe(session: Session): void;
/** Pre-warm every installed distro on plugin activation (non-blocking). */
export declare function prewarmWslProbes(): Promise<void>;
/**
 * Dynamic environment block (top of the runtime context). Modeled after
 * Cursor's environment header: cwd, git state, platform, shell, OS, python.
 * Order 5 keeps it ABOVE every framework context (110+).
 * For WSL workspaces it reflects the Linux environment instead of win32.
 * Pure read — no probes are triggered here.
 */
export declare function environmentBlock(ctx: Context, session: Session): string;
