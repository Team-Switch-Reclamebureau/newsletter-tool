import { error, json } from '@sveltejs/kit';
import { validEmail } from '#lib/email-settings.js';
import { isAPIError } from 'better-auth/api';
import { api, rateLimit, readJson, requireUser } from '#lib/server/http.js';
import { sendEmailChangeLink } from '#lib/server/account-email.js';

export const PATCH = api(async (event) => {
	const { auth } = requireUser(event);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => key !== 'name')) error(400, 'Only name can be updated here.');
	if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name)) {
		error(400, 'Enter a name between 1 and 80 characters without control characters.');
	}
	return auth.api.updateUser({ headers: event.request.headers, body: { name: body.name.trim() }, asResponse: true });
});

export const POST = api(async (event) => {
	const { auth, pool, config, user } = requireUser(event);
	await rateLimit(pool, `change-email:${user.id}`, 5);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => !['email', 'currentPassword'].includes(key))) error(400, 'Only email and currentPassword can be submitted.');
	if (!validEmail(body.email)) error(400, 'Enter a valid email address.');
	if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 128) error(400, 'Enter your current password.');
	const email = body.email.toLowerCase();
	if (email === user.email.toLowerCase()) error(400, 'Enter a different email address.');
	try {
		await auth.api.verifyPassword({ headers: event.request.headers, body: { password: body.currentPassword } });
	} catch (cause) {
		if (isAPIError(cause)) error(cause.statusCode, cause.body?.message || 'Could not verify your current password.');
		throw cause;
	}
	if ((await pool.query('SELECT id FROM "user" WHERE lower(email) = $1', [email])).rowCount) error(409, 'An account with this email address already exists.');
	try {
		await sendEmailChangeLink(pool, config, user, email);
	} catch (cause) {
		console.error('Email verification delivery failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The verification email could not be sent. Contact your administrator to check SMTP settings, then try again.');
	}
	return json({ status: true });
});
