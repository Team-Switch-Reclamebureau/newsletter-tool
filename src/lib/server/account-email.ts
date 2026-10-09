import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { createAuth } from './auth';
import type { ServerConfig } from './config';
import { sendEmail } from './email';
import { readApplicationSettings } from './application-settings';

export async function sendPasswordLink(pool: Pool, config: ServerConfig, auth: ReturnType<typeof createAuth>, email: string) {
	const { internalAdapter } = await auth.$context;
	const account = await internalAdapter.findUserByEmail(email);
	const token = randomBytes(24).toString('base64url');
	if (!account) {
		await internalAdapter.findVerificationValue(`reset-password:${token}`);
		return;
	}
	const user = account.user;
	const identifier = `reset-password:${token}`;
	await internalAdapter.createVerificationValue({ identifier, value: user.id, expiresAt: new Date(Date.now() + 3600_000) });
	try {
		const pending = await pool.query('SELECT user_id FROM user_invitations WHERE user_id = $1', [user.id]);
		const invited = Boolean(pending.rowCount);
		const { applicationName } = await readApplicationSettings(pool);
		const url = new URL('/reset-password', config.origin);
		url.searchParams.set('token', token);
		if (invited) url.searchParams.set('invitation', '1');
		await sendEmail(pool, config.authSecret, user.email,
			invited ? `You're invited to ${applicationName}` : `Reset your ${applicationName} password`,
			`Hello ${user.name},\n\n${invited ? `You've been invited to ${applicationName}. Choose a password to activate your account` : 'Reset your password'}:\n\n${url.href}\n\nThis link expires in one hour and can only be used once.\nIf you did not expect this email, you can ignore it.`);
		if (invited) await pool.query('UPDATE user_invitations SET sent_at = now() WHERE user_id = $1', [user.id]);
	} catch (cause) {
		await internalAdapter.deleteVerificationByIdentifier(identifier);
		throw cause;
	}
}
