import type { Context } from '@deepseek-ai/cordis';
/** Required services: the web route registry, the user-settings seam, and the tool registry. */
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
