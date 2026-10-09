import { error, json } from '@sveltejs/kit';
import { emailSettingsError } from '#lib/email-settings.js';
import { encryptSmtpPassword, readEmailSettings, sendEmail } from '#lib/server/email.js';
import { api, rateLimit, readJson, requireAdmin, revision } from '#lib/server/http.js';

export const GET = api(async (event) => {
	const { pool } = requireAdmin(event);
	return json({ settings: await readEmailSettings(pool) });
});

export const PATCH = api(async (event) => {
	const { pool, config } = requireAdmin(event);
	const body = await readJson(event.request);
	const invalid = emailSettingsError(body);
	if (invalid) error(400, invalid);
	if (typeof body.host !== 'string' || typeof body.fromEmail !== 'string' || typeof body.fromName !== 'string'
		|| typeof body.username !== 'string' || typeof body.password !== 'string') error(400, 'Send valid SMTP settings.');
	const expected = revision(body.revision);
	const encrypted = body.clearPassword ? '' : body.password ? encryptSmtpPassword(body.password, config.authSecret) : null;
	const result = await pool.query(`
		UPDATE smtp_settings SET host = $1, port = $2, security = $3, username = $4,
			password_encrypted = COALESCE($5, password_encrypted), from_email = $6, from_name = $7,
			revision = revision + 1 WHERE singleton = true AND revision = $8 RETURNING revision`,
		[body.host.trim(), body.port, body.security, body.username.trim(), encrypted, body.fromEmail.toLowerCase(), body.fromName.trim(), expected]);
	if (!result.rowCount) error(409, 'Email settings changed elsewhere. Reload before saving.');
	return json({ settings: await readEmailSettings(pool) });
});

export const POST = api(async (event) => {
	const { pool, config, user } = requireAdmin(event);
	await rateLimit(pool, `test-email:${user.id}`, 3);
	try {
		await sendEmail(pool, config.authSecret, user.email, 'SMTP test', 'Your newsletter workspace can send account emails using these SMTP settings.');
	} catch (cause) {
		console.error('SMTP test failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The test email could not be sent. Check the saved SMTP settings and server logs.');
	}
	return json({ message: `Test email accepted by the SMTP server for ${user.email}.` });
});
