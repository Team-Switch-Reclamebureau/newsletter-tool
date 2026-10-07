import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { createAuth } from '../../src/lib/server/auth';
import { migrateDatabase } from '../../src/lib/server/migrations';
import type { ServerConfig } from '../../src/lib/server/config';

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not allocate a test port.');
	const port = address.port;
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return port;
}

export async function startHostedFixture() {
	const directory = await mkdtemp(join(tmpdir(), 'postroom-hosted-test-'));
	const pgPort = await freePort();
	const appPort = await freePort();
	const databasePassword = randomBytes(24).toString('hex');
	const password = randomBytes(24).toString('hex');
	const databaseLogs: string[] = [];
	const postgres = new EmbeddedPostgres({
		databaseDir: join(directory, 'postgres'), port: pgPort, user: 'postgres',
		password: databasePassword, persistent: true, createPostgresUser: false,
		onLog: (value) => databaseLogs.push(value),
		onError: (value) => databaseLogs.push(String(value))
	});
	let app: ChildProcess | undefined;
	let pool: Pool | undefined;
	let started = false;
	const appLogs: string[] = [];
	const config: ServerConfig = {
		databaseUrl: `postgresql://postgres:${databasePassword}@127.0.0.1:${pgPort}/postroom_test`,
		authSecret: randomBytes(32).toString('hex'),
		origin: `http://127.0.0.1:${appPort}`, uploadDir: join(directory, 'uploads')
	};

	async function stop() {
		if (app && app.exitCode === null) {
			const current = app;
			current.kill('SIGTERM');
			await Promise.race([
				new Promise<void>((resolve) => current.once('exit', () => resolve())),
				delay(5000).then(() => { if (current.exitCode === null) current.kill('SIGKILL'); })
			]);
		}
		if (pool) await pool.end();
		if (started) await postgres.stop();
		await rm(directory, { recursive: true, force: true });
	}

	try {
		await postgres.initialise();
		await postgres.start();
		started = true;
		await postgres.createDatabase('postroom_test');
		pool = new Pool({ connectionString: config.databaseUrl });
		// The password is generated hexadecimal test data, not user input.
		await pool.query(`CREATE ROLE postroom_app LOGIN PASSWORD '${databasePassword}'`);
		await pool.query('GRANT CONNECT ON DATABASE postroom_test TO postroom_app; GRANT USAGE ON SCHEMA public TO postroom_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO postroom_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO postroom_app');
		const auth = createAuth(pool, config);
		await migrateDatabase(pool, auth, resolve('migrations'));
		// Running twice verifies that deployment migrations are repeatable.
		await migrateDatabase(pool, auth, resolve('migrations'));
		const users = ['owner@example.test', 'outsider@example.test', 'member@example.test'];
		for (const email of users) await auth.api.signUpEmail({ body: { email, name: email.split('@')[0], password } });
		await pool.query('INSERT INTO application_admins(user_id) SELECT id FROM "user" WHERE email = $1', ['owner@example.test']);
		app = spawn(process.execPath, ['build/index.js'], {
			cwd: process.cwd(),
			env: {
				...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(appPort),
				ORIGIN: config.origin, APP_ORIGIN: config.origin,
				DATABASE_URL: `postgresql://postroom_app:${databasePassword}@127.0.0.1:${pgPort}/postroom_test`,
				BETTER_AUTH_SECRET: config.authSecret, UPLOAD_DIR: config.uploadDir,
				BODY_SIZE_LIMIT: '13M'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		app.stdout?.on('data', (data) => appLogs.push(String(data)));
		app.stderr?.on('data', (data) => appLogs.push(String(data)));
		let ready = false;
		for (let attempt = 0; attempt < 120; attempt++) {
			if (app.exitCode !== null) throw new Error(`The test application exited: ${appLogs.join('\n')}`);
			try { ready = (await fetch(`${config.origin}/healthz`)).ok; }
			catch { ready = false; }
			if (ready) break;
			await delay(250);
		}
		if (!ready) throw new Error(`The test application did not become healthy: ${appLogs.join('\n')}`);
		return { origin: config.origin, password, pool, stop, directory, appLogs };
	} catch (cause) {
		await stop();
		throw new Error(`Could not start the PostgreSQL integration fixture: ${cause instanceof Error ? cause.message : String(cause)}\n${databaseLogs.slice(-15).join('\n')}`);
	}
}
