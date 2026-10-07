import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { createAuth } from './auth';

export async function migrateDatabase(pool: Pool, auth: ReturnType<typeof createAuth>, directory: string) {
	const client = await pool.connect();
	try {
		await client.query('SELECT pg_advisory_lock(731924001)');
		await (await auth.$context).runMigrations();
		await client.query('CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
		for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
			const applied = await client.query('SELECT name FROM app_migrations WHERE name = $1', [name]);
			if (applied.rowCount) continue;
			const sql = await readFile(join(directory, name), 'utf8');
			await client.query('BEGIN');
			try {
				await client.query(sql);
				await client.query('INSERT INTO app_migrations(name) VALUES ($1)', [name]);
				await client.query('COMMIT');
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			}
		}
	} finally {
		try { await client.query('SELECT pg_advisory_unlock(731924001)'); }
		finally { client.release(); }
	}
}
