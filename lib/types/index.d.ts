import type { Context } from '@deepseek-ai/cordis';
/** Required services: the web route registry, the user-settings seam, the tool registry, the workspace resolver, the prompt-context system and the shell executor. */
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
