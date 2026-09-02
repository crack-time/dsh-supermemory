import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
export { isWslWorkspace, distroOf, type WslProbe } from './wsl-env-lib.ts';
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
