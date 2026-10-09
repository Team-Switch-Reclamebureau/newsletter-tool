import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import type { ServerConfig } from './config';

export function createAuth(pool: Pool, config: ServerConfig) {
	return betterAuth({
		appName: 'Postroom',
		database: pool,
		secret: config.authSecret,
		baseURL: config.origin,
		trustedOrigins: [config.origin],
		telemetry: { enabled: false },
		emailAndPassword: {
			enabled: true, minPasswordLength: 12, autoSignIn: false,
			resetPasswordTokenExpiresIn: 3600, revokeSessionsOnPasswordReset: true,
			onPasswordReset: async ({ user }) => {
				await pool.query('DELETE FROM user_invitations WHERE user_id = $1', [user.id]);
				await pool.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [user.id]);
				await pool.query("DELETE FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%'", [user.id]);
			}
		},
		session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
		rateLimit: {
			enabled: true, storage: 'database', window: 60, max: 30,
			customRules: {
				'/sign-in/email': { window: 60, max: 5 },
				'/reset-password': { window: 60, max: 5 },
				'/change-password': { window: 60, max: 5 }
			}
		},
		advanced: { useSecureCookies: config.origin.startsWith('https:') }
	});
}

// Registration is internal only, used by administrator provisioning and invitations.
export const PUBLIC_AUTH_PATHS = new Set([
	'/sign-in/email', '/sign-out', '/get-session', '/reset-password', '/change-password'
]);
