import type { Context } from '@deepseek-ai/cordis';
/** Required services: the web route registry and the user-settings seam. */
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
