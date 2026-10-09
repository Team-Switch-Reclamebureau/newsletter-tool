import { randomBytes } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { validEmail } from '#lib/email-settings.js';
import { readAdminUsers } from '#lib/server/admin-users.js';
import { readEmailSettings } from '#lib/server/email.js';
import { api, rateLimit, readJson, requireAdmin } from '#lib/server/http.js';
import { sendPasswordLink } from '#lib/server/account-email.js';

export const GET = api(async (event) => {
	const { pool } = requireAdmin(event);
	return json({ users: await readAdminUsers(pool) });
});

export const POST = api(async (event) => {
	const { pool, auth, config, user } = requireAdmin(event);
	await rateLimit(pool, `invite-user:${user.id}`, 5);
	const body = await readJson(event.request);
	if (!validEmail(body.email)) error(400, 'Enter a valid email address.');
	if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name)) error(400, 'Enter a name between 1 and 80 characters without control characters.');
	const email = body.email.toLowerCase();
	const settings = await readEmailSettings(pool);
	if (!settings.host || !settings.fromEmail) error(503, 'Save SMTP settings before inviting users.');
	if ((await pool.query('SELECT id FROM "user" WHERE lower(email) = $1', [email])).rowCount) error(409, 'An account with this email already exists. Resend its pending invitation from the user list.');
	const created = await auth.api.signUpEmail({ body: { email, name: body.name.trim(), password: randomBytes(32).toString('hex') } });
	await pool.query('INSERT INTO user_invitations(user_id) VALUES ($1)', [created.user.id]);
	try {
		await sendPasswordLink(pool, config, auth, email);
	} catch (cause) {
		console.error('Invitation delivery failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The account was created, but its invitation could not be sent. Check SMTP settings, then resend the invitation from the user list.');
	}
	return json({ users: await readAdminUsers(pool) }, { status: 201 });
});
