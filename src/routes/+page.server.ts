import { redirect } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import { listProjects } from '#lib/server/workspace.js';
import { listSignatures } from '#lib/server/signatures.js';
import { getUserPreferences } from '#lib/server/user-preferences.js';
import { DEFAULT_USER_PREFERENCES } from '#lib/user-preferences.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const runtime = getRuntime();
	if (!runtime) return { configured: false, user: null, projects: [], signatures: [], initialProjectId: null, creatingProject: false, preferences: { ...DEFAULT_USER_PREFERENCES } };
	if (!locals.user) redirect(303, '/login');
	const [projects, preferences, signatures] = await Promise.all([
		listProjects(runtime.pool, locals.user.id),
		getUserPreferences(runtime.pool, locals.user.id),
		listSignatures(runtime.pool)
	]);
	return { configured: true, user: locals.user, projects, signatures, initialProjectId: url.searchParams.get('project'), creatingProject: url.searchParams.get('new') === '1', preferences };
};
