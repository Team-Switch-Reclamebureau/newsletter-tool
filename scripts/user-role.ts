import { Pool } from 'pg';
import { readServerConfig } from '../src/lib/server/config';

const config = readServerConfig(process.env);
if (!config) throw new Error('Configure the server environment before managing administrator access.');
const [email, role, ...extra] = process.argv.slice(2);
if (!email || !['admin', 'user'].includes(role) || extra.length) {
	throw new Error('Usage: npm run user:role -- person@example.com admin|user (database owner connection required)');
}
const pool = new Pool({ connectionString: config.databaseUrl });
try {
	const users = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1)', [email]);
	if (!users.rowCount) throw new Error('No provisioned account has that email address.');
	if (role === 'admin') await pool.query('INSERT INTO application_admins(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [users.rows[0].id]);
	else await pool.query('DELETE FROM application_admins WHERE user_id = $1', [users.rows[0].id]);
	console.log(role === 'admin' ? 'Administrator access granted.' : 'Administrator access removed. Project access is unchanged.');
} finally {
	await pool.end();
}
