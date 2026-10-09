import { error, json } from '@sveltejs/kit';
import { validEmail } from '#lib/email-settings.js';
import { sendPasswordLink } from '#lib/server/account-email.js';
import { readEmailSettings } from '#lib/server/email.js';
import { api, rateLimit, readJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';

export const POST = api(async (event) => {
	const runtime = getRuntime();
	if (!runtime) error(503, 'Configure the hosted workspace first.');
	if (event.request.headers.get('origin') !== runtime.config.origin) error(403, 'This request must come from the configured application origin.');
	await rateLimit(runtime.pool, `password-recovery-ip:${event.getClientAddress()}`, 3);
	const body = await readJson(event.request);
	if (!validEmail(body.email)) error(400, 'Enter a valid email address.');
	const email = body.email.toLowerCase();
	await rateLimit(runtime.pool, `password-recovery-email:${email}`, 3);
	const settings = await readEmailSettings(runtime.pool);
	if (!settings.host || !settings.fromEmail) error(503, 'Password recovery is unavailable. Contact your administrator to configure SMTP.');
	try {
		await sendPasswordLink(runtime.pool, runtime.config, runtime.auth, email);
	} catch (cause) {
		console.error('Password recovery email failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The account email could not be sent. Contact your administrator or try again later.');
	}
	return json({ status: true, message: 'If this email exists in our system, check your email for the reset link' });
});
