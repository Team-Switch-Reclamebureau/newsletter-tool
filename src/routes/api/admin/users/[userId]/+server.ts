import { error, json } from '@sveltejs/kit';
import { readAdminUsers } from '#lib/server/admin-users.js';
import { api, rateLimit, readJson, requireAdmin } from '#lib/server/http.js';
import { sendPasswordLink } from '#lib/server/account-email.js';

export const PATCH = api(async (event) => {
	const { pool, user } = requireAdmin(event);
	const body = await readJson(event.request);
	if (typeof body.isAdmin !== 'boolean') error(400, 'Specify administrator access as a boolean.');
	const id = event.params.userId;
	if (id === user.id) error(400, 'You cannot change your own administrator access. Ask another administrator.');
	if (!(await pool.query('SELECT id FROM "user" WHERE id = $1', [id])).rowCount) error(404, 'User not found.');
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('SELECT singleton FROM application_settings WHERE singleton = true FOR UPDATE');
		if (!(await client.query('SELECT user_id FROM application_admins WHERE user_id = $1', [user.id])).rowCount) error(403, 'Administrator access is required.');
		if (body.isAdmin) await client.query('INSERT INTO application_admins(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
		else await client.query('DELETE FROM application_admins WHERE user_id = $1', [id]);
		await client.query('COMMIT');
	} catch (cause) {
		await client.query('ROLLBACK');
		throw cause;
	} finally { client.release(); }
	return json({ users: await readAdminUsers(pool) });
});

export const POST = api(async (event) => {
	const { pool, auth, config, user } = requireAdmin(event);
	await rateLimit(pool, `resend-invitation:${user.id}`, 5);
	const pending = await pool.query<{ email: string }>('SELECT u.email FROM "user" u JOIN user_invitations i ON i.user_id = u.id WHERE u.id = $1', [event.params.userId]);
	if (!pending.rows[0]) error(404, 'Pending invitation not found.');
	try {
		await sendPasswordLink(pool, config, auth, pending.rows[0].email);
	} catch (cause) {
		console.error('Invitation resend failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The invitation could not be sent. Check SMTP settings and try again.');
	}
	return json({ users: await readAdminUsers(pool) });
});
