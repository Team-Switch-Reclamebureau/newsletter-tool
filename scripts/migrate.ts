import { Pool } from 'pg';
import { readServerConfig } from '../src/lib/server/config';
import { createAuth } from '../src/lib/server/auth';
import { migrateDatabase } from '../src/lib/server/migrations';

const config = readServerConfig(process.env);
if (!config) throw new Error('Configure DATABASE_URL, BETTER_AUTH_SECRET, and APP_ORIGIN before running migrations.');
const pool = new Pool({ connectionString: config.databaseUrl });
try {
	await migrateDatabase(pool, createAuth(pool, config), new URL('../migrations', import.meta.url).pathname);
	console.log('Database migrations completed.');
} finally {
	await pool.end();
}
