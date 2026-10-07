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
		emailAndPassword: { enabled: true, minPasswordLength: 12 },
		session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
		rateLimit: {
			enabled: true, storage: 'database', window: 60, max: 30,
			customRules: { '/sign-in/email': { window: 60, max: 5 } }
		},
		advanced: { useSecureCookies: config.origin.startsWith('https:') }
	});
}

// Registration exists only as an internal API used by the administrator CLI.
export const PUBLIC_AUTH_PATHS = new Set(['/sign-in/email', '/sign-out', '/get-session']);
