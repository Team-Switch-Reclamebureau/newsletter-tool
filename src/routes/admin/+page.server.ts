import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/http.js';
import type { PageServerLoad } from './$types';
import { readAdminUsers } from '#lib/server/admin-users.js';
import { readEmailSettings } from '#lib/server/email.js';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) redirect(303, '/login');
	const { pool, user } = requireAdmin(event);
	const [users, emailSettings] = await Promise.all([readAdminUsers(pool), readEmailSettings(pool)]);
	return { users, emailSettings, currentUserId: user.id };
};
