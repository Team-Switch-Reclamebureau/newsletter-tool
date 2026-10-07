import { redirect } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!getRuntime()) redirect(303, '/');
	if (locals.user) redirect(303, '/');
	return {};
};
