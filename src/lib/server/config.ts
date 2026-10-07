import { resolve } from 'node:path';

export interface ServerConfig {
	databaseUrl: string;
	authSecret: string;
	origin: string;
	uploadDir: string;
}

export function readServerConfig(environment: Record<string, string | undefined>): ServerConfig | null {
	const { DATABASE_URL, BETTER_AUTH_SECRET, APP_ORIGIN } = environment;
	if (!DATABASE_URL && !BETTER_AUTH_SECRET && !APP_ORIGIN) return null;
	if (!DATABASE_URL || !BETTER_AUTH_SECRET || !APP_ORIGIN) {
		throw new Error('Set DATABASE_URL, BETTER_AUTH_SECRET, and APP_ORIGIN to enable the hosted workspace.');
	}
	if (BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
	const database = new URL(DATABASE_URL);
	if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
	const origin = new URL(APP_ORIGIN);
	if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== APP_ORIGIN
		|| origin.username || origin.password) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a trailing slash.');
	if (environment.NODE_ENV === 'production' && origin.protocol !== 'https:'
		&& !['localhost', '127.0.0.1'].includes(origin.hostname)) {
		throw new Error('Production APP_ORIGIN must use HTTPS.');
	}
	return {
		databaseUrl: DATABASE_URL, authSecret: BETTER_AUTH_SECRET,
		origin: APP_ORIGIN, uploadDir: resolve(environment.UPLOAD_DIR || 'data/uploads')
	};
}
