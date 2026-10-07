import { DEFAULT_APPLICATION_SETTINGS } from '#lib/application-settings.js';
import { readApplicationSettings } from '#lib/server/application-settings.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const runtime = getRuntime();
	return {
		settings: runtime ? await readApplicationSettings(runtime.pool) : { ...DEFAULT_APPLICATION_SETTINGS },
		isAdmin: locals.user?.isAdmin ?? false
	};
};
