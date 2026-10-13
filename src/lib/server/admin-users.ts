import type { Pool } from 'pg';
import type { AdminUser } from '../admin-users';
import { error } from '@sveltejs/kit';
import { transaction } from './workspace';

export async function deleteAdminUser(pool: Pool, actorId: string, userId: string) {
	if (actorId === userId) error(400, 'You cannot delete your own account. Ask another administrator.');
	return transaction(pool, async (client) => {
		await client.query('SELECT singleton FROM application_settings WHERE singleton = true FOR UPDATE');
		if (!(await client.query('SELECT user_id FROM application_admins WHERE user_id = $1', [actorId])).rowCount) error(403, 'Administrator access is required.');
		const target = await client.query<{ is_admin: boolean }>(`
			SELECT EXISTS(SELECT 1 FROM application_admins a WHERE a.user_id = u.id) AS is_admin
			FROM "user" u WHERE u.id = $1 FOR UPDATE OF u`, [userId]);
		if (!target.rows[0]) error(404, 'User not found.');
		if (target.rows[0].is_admin) {
			const admins = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM application_admins');
			if (admins.rows[0].count <= 1) error(409, 'The last administrator cannot be deleted.');
		}
		const transferred = await client.query(`
			INSERT INTO project_members(project_id, user_id, role)
			SELECT project_id, $2, 'owner' FROM project_members WHERE user_id = $1 AND role = 'owner'
			ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'
			RETURNING project_id`, [userId, actorId]);
		await client.query("DELETE FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%'", [userId]);
		await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
		return transferred.rows.length;
	});
}

export async function readAdminUsers(pool: Pool): Promise<AdminUser[]> {
	const result = await pool.query<AdminUser>(`
		SELECT u.id, u.name, u.email,
			EXISTS(SELECT 1 FROM application_admins a WHERE a.user_id = u.id) AS "isAdmin",
			i.invited_at::text AS "invitedAt", i.sent_at::text AS "sentAt"
		FROM "user" u LEFT JOIN user_invitations i ON i.user_id = u.id
		ORDER BY lower(u.name), u.email`);
	return result.rows;
}
