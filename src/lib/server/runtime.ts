import { env } from '$env/dynamic/private';
import { Pool } from 'pg';
import { createAuth } from './auth';
import { readServerConfig } from './config';
import { LocalImageStorage } from './storage';

let runtime: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
	const config = readServerConfig(env);
	if (!config) return null;
	const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
	pool.on('error', (error) => console.error('PostgreSQL connection failed:', error.message));
	return { config, pool, auth: createAuth(pool, config), storage: new LocalImageStorage(config.uploadDir) };
}

export function getRuntime() {
	runtime ??= createRuntime();
	return runtime;
}
