import type { Context } from '@deepseek-ai/cordis';
/** Required services: the web route registry, the user-settings seam, the tool registry, the workspace resolver, the prompt-context system, the shell executor, the live session store and session persistence (cold archive-time reads). */
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
