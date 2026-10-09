import type { Pool } from 'pg';
import type { AdminUser } from '../admin-users';

export async function readAdminUsers(pool: Pool): Promise<AdminUser[]> {
	const result = await pool.query<AdminUser>(`
		SELECT u.id, u.name, u.email,
			EXISTS(SELECT 1 FROM application_admins a WHERE a.user_id = u.id) AS "isAdmin",
			i.invited_at::text AS "invitedAt", i.sent_at::text AS "sentAt"
		FROM "user" u LEFT JOIN user_invitations i ON i.user_id = u.id
		ORDER BY lower(u.name), u.email`);
	return result.rows;
}
