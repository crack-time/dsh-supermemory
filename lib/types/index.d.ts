import type { Context } from '@deepseek-ai/cordis';
/** Required services: the web route registry, the user-settings seam, the tool registry, and the agent factory (for context injection). */
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
