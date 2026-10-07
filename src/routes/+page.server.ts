import { redirect } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import { listProjects } from '#lib/server/workspace.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const runtime = getRuntime();
	if (!runtime) return { configured: false, user: null, projects: [] };
	if (!locals.user) redirect(303, '/login');
	return { configured: true, user: locals.user, projects: await listProjects(runtime.pool, locals.user.id) };
};
