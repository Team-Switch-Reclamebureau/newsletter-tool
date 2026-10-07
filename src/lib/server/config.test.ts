import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readServerConfig } from './config';

function environment() {
	return { DATABASE_URL: 'postgresql://localhost/postroom', BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:5173' };
}

describe('self-hosted configuration', () => {
	it('explicitly reports an unconfigured workspace', () => {
		expect(readServerConfig({})).toBeNull();
	});

	it('validates required settings and the secret length', () => {
		expect(() => readServerConfig({ APP_ORIGIN: 'http://localhost:5173' })).toThrow('Set DATABASE_URL');
		expect(() => readServerConfig({ ...environment(), BETTER_AUTH_SECRET: 'too-short' })).toThrow('32');
	});

	it('requires PostgreSQL and a canonical HTTP(S) origin', () => {
		expect(() => readServerConfig({ ...environment(), DATABASE_URL: 'file:///database' })).toThrow('PostgreSQL');
		expect(() => readServerConfig({ ...environment(), APP_ORIGIN: 'https://example.com/' })).toThrow('trailing slash');
		expect(() => readServerConfig({ ...environment(), APP_ORIGIN: 'https://user:password@example.com' })).toThrow('origin');
	});

	it('requires HTTPS for a public production deployment', () => {
		expect(() => readServerConfig({ ...environment(), NODE_ENV: 'production', APP_ORIGIN: 'http://example.com' })).toThrow('HTTPS');
		expect(readServerConfig({ ...environment(), NODE_ENV: 'production' })?.origin).toBe('http://localhost:5173');
	});

});
