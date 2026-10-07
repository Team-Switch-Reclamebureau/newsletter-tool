import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/http.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (!event.locals.user) redirect(303, '/login');
	requireAdmin(event);
	return {};
};
