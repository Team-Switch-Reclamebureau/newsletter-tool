import { password } from '@inquirer/prompts';
import { Pool } from 'pg';
import { readServerConfig } from '../src/lib/server/config';
import { createAuth } from '../src/lib/server/auth';

const config = readServerConfig(process.env);
if (!config) throw new Error('Configure the server environment before provisioning users.');
const [email, name, flag, ...extra] = process.argv.slice(2);
if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (flag && flag !== '--admin') || extra.length) {
	throw new Error('Usage: npm run user:create -- person@example.com "Person Name" [--admin]');
}
const userPassword = await password({ message: 'Password (at least 12 characters):', mask: '*' });
if (userPassword.length < 12) throw new Error('The password must contain at least 12 characters.');
const pool = new Pool({ connectionString: config.databaseUrl });
try {
	const created = await createAuth(pool, config).api.signUpEmail({ body: { email, name, password: userPassword } });
	if (flag === '--admin') await pool.query('INSERT INTO application_admins(user_id) VALUES ($1)', [created.user.id]);
	console.log(flag === '--admin' ? 'Administrator created. They can now sign in and manage application settings.' : 'User created. They can now sign in. Project owners can add them by email.');
} finally {
	await pool.end();
}
