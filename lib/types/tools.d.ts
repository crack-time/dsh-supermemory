/**
 * AI-facing memory tools registered into the dsh tool runtime. Host-side calls
 * with the configured Bearer key — the model never sees credentials and
 * nothing crosses the browser origin. All container switching goes through
 * the shared setActiveContainer / discoverContainers helpers.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
/** Register every AI-facing memory tool into the dsh tool runtime. */
export declare function registerMemoryTools(ctx: Context, scope: SettingsScope<any>): Array<() => void>;
