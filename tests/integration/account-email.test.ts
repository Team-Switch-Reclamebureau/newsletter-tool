import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { AdminUser } from '../../src/lib/admin-users';
import type { EmailSettings } from '../../src/lib/email-settings';
import { startHostedFixture } from '../helpers/hosted-fixture';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let smtp: SMTPServer;
let smtpPort = 0;
let ownerCookie = '';
let outsiderCookie = '';
let memberCookie = '';
let rejected = false;
const messages: string[] = [];

async function request(path: string, method = 'GET', body?: unknown, cookie = ownerCookie, origin?: string) {
	return fetch(`${fixture.origin}${path}`, {
		method, redirect: 'manual',
		headers: { Accept: 'application/json', Origin: origin ?? fixture.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function login(email: string, password = fixture.password) {
	const response = await request('/api/auth/sign-in/email', 'POST', { email, password }, '');
	expect(response.status).toBe(200);
	return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

function token(message: string) {
	const decoded = message.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
	const match = decoded.match(/\/reset-password\?token=([a-zA-Z0-9_-]+)/);
	if (!match) throw new Error(`No password link in test email: ${decoded}`);
	return match[1];
}

beforeAll(async () => {
	smtp = new SMTPServer({
		disabledCommands: ['STARTTLS'], authOptional: true,
		onAuth(auth, _session, callback) {
			if (auth.username === 'test-user' && auth.password === 'test-smtp-password') callback(null, { user: auth.username });
			else callback(new Error('Invalid test credentials'));
		},
		onData(stream, _session, callback) {
			let message = '';
			stream.on('data', (chunk) => { message += chunk.toString(); });
			stream.on('error', callback);
			stream.on('end', () => {
				if (rejected) callback(new Error('Test SMTP delivery failure'));
				else { messages.push(message); callback(); }
			});
		}
	});
	await new Promise<void>((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
	const address = smtp.server.address();
	if (!address || typeof address === 'string') throw new Error('No SMTP port allocated.');
	smtpPort = address.port;
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	outsiderCookie = await login('outsider@example.test');
});

afterAll(async () => {
	if (fixture) await fixture.stop();
	if (smtp) await new Promise<void>((resolve) => smtp.close(resolve));
});

describe('account email through real SMTP and PostgreSQL', () => {
	it('renders settings as linked tabs with only the initial panel visible', async () => {
		function elements(node: DefaultTreeAdapterMap['node']): DefaultTreeAdapterMap['element'][] {
			return [
				...('tagName' in node ? [node] : []),
				...('childNodes' in node ? node.childNodes.flatMap(elements) : [])
			];
		}
		for (const [path, ids, fields] of [
			['/admin', ['branding', 'email', 'users'], ['application-name', 'smtp-host']],
			['/account', ['profile', 'email', 'password'], ['profile-name', 'profile-email', 'new-password']]
		] as const) {
			const response = await request(path);
			expect(response.status).toBe(200);
			const nodes = elements(parse(await response.text()));
			const attribute = (node: DefaultTreeAdapterMap['element'], name: string) => node.attrs.find((attr) => attr.name === name)?.value;
			expect(nodes.some((node) => node.tagName === 'main' && attribute(node, 'class')?.split(' ').includes('settings-layout'))).toBe(true);
			expect(nodes.some((node) => node.tagName === 'header' && elements(node).some((child) => child.tagName === 'a' && attribute(child, 'href') === '/'))).toBe(true);
			const tabs = nodes.filter((node) => attribute(node, 'role') === 'tab');
			const panels = nodes.filter((node) => attribute(node, 'role') === 'tabpanel');
			expect(tabs).toHaveLength(3);
			expect(panels).toHaveLength(3);
			ids.forEach((id, index) => {
				expect(attribute(tabs[index], 'id')).toBe(`settings-tab-${id}`);
				expect(attribute(tabs[index], 'aria-controls')).toBe(`settings-panel-${id}`);
				expect(attribute(tabs[index], 'aria-selected')).toBe(String(index === 0));
				expect(attribute(tabs[index], 'tabindex')).toBe(index === 0 ? '0' : '-1');
				expect(attribute(panels[index], 'id')).toBe(`settings-panel-${id}`);
				expect(attribute(panels[index], 'aria-labelledby')).toBe(`settings-tab-${id}`);
				expect(attribute(panels[index], 'hidden')).toBe(index === 0 ? undefined : '');
			});
			for (const id of fields) expect(nodes.some((node) => attribute(node, 'id') === id)).toBe(true);
		}
	});

	it('restricts SMTP and user management to administrators and leaves registration closed', async () => {
		for (const path of ['/api/admin/email', '/api/admin/users']) {
			expect((await request(path, 'GET', undefined, '')).status).toBe(401);
			expect((await request(path, 'GET', undefined, outsiderCookie)).status).toBe(403);
		}
		expect((await request('/api/admin/users', 'POST', {}, ownerCookie, 'https://wrong.test')).status).toBe(403);
		expect((await request('/api/auth/sign-up/email', 'POST', { email: 'public@example.test', name: 'Public', password: fixture.password }, '')).status).toBe(403);
		const unavailable = await request('/api/auth/request-password-reset', 'POST', { email: 'owner@example.test' }, '');
		expect(unavailable.status).toBe(503);
		expect((await unavailable.json()).message).toContain('SMTP');
		expect((await request('/api/admin/users', 'POST', { email: 'new@example.test', name: 'New' })).status).toBe(503);
		expect((await fixture.pool.query('SELECT id FROM "user" WHERE email = $1', ['new@example.test'])).rowCount).toBe(0);
	});

	it('saves encrypted SMTP credentials, protects revisions, and sends a test email', async () => {
		const initial = (await (await request('/api/admin/email')).json()).settings as EmailSettings;
		const settings = { ...initial, host: '127.0.0.1', port: smtpPort, security: 'none', username: 'test-user', password: 'test-smtp-password', clearPassword: false, fromEmail: 'postroom@example.test', fromName: 'Postroom' };
		expect((await request('/api/admin/email', 'PATCH', { ...settings, port: 65536 })).status).toBe(400);
		const saved = await request('/api/admin/email', 'PATCH', settings);
		expect(saved.status).toBe(200);
		const body = await saved.json();
		expect(body.settings.passwordConfigured).toBe(true);
		expect(JSON.stringify(body)).not.toContain('test-smtp-password');
		expect(JSON.stringify(body)).not.toContain('password_encrypted');
		const encrypted = (await fixture.pool.query('SELECT password_encrypted FROM smtp_settings')).rows[0].password_encrypted;
		expect(encrypted).not.toBe('test-smtp-password');
		expect((await request('/api/admin/email', 'PATCH', settings)).status).toBe(409);
		expect((await request('/api/admin/email', 'PATCH', { ...settings, password: '', revision: body.settings.revision })).status).toBe(200);
		expect((await fixture.pool.query('SELECT password_encrypted FROM smtp_settings')).rows[0].password_encrypted).toBe(encrypted);
		expect((await request('/api/admin/email', 'POST', {})).status).toBe(200);
		expect(messages.at(-1)).toContain('owner@example.test');
		expect(messages.at(-1)).toContain('SMTP test');
		const current = (await (await request('/api/admin/email')).json()).settings as EmailSettings;
		const secured = await request('/api/admin/email', 'PATCH', { ...current, security: 'starttls', password: '', clearPassword: false });
		expect(secured.status).toBe(200);
		expect((await request('/api/admin/email', 'POST', {})).status).toBe(503);
		const secureSettings = (await secured.json()).settings as EmailSettings;
		expect((await request('/api/admin/email', 'PATCH', { ...secureSettings, security: 'none', password: '', clearPassword: false })).status).toBe(200);
	});

	it('invites, resends, accepts a single-use link, and manages administrator roles', async () => {
		const invitation = await request('/api/admin/users', 'POST', { name: 'Invited User', email: 'INVITED@example.test' });
		expect(invitation.status).toBe(201);
		const users = (await invitation.json()).users as AdminUser[];
		const invited = users.find((user) => user.email === 'invited@example.test')!;
		expect(invited.invitedAt).toBeTruthy();
		expect(invited.sentAt).toBeTruthy();
		expect(invited.isAdmin).toBe(false);
		const firstToken = token(messages.at(-1)!);
		expect(messages.at(-1)).toContain('invited@example.test');
		expect((await request('/api/admin/users', 'POST', { name: 'Duplicate', email: invited.email })).status).toBe(409);
		const path = `/api/admin/users/${invited.id}`;
		expect((await request(path, 'POST', {}, outsiderCookie)).status).toBe(403);
		expect((await request(path, 'PATCH', { isAdmin: true }, outsiderCookie)).status).toBe(403);
		expect((await request(path, 'POST', {})).status).toBe(200);
		const secondToken = token(messages.at(-1)!);
		expect(secondToken).not.toBe(firstToken);
		const page = await request(`/reset-password?token=${secondToken}&invitation=1`, 'GET', undefined, '');
		expect(page.status).toBe(200);
		expect(page.headers.get('referrer-policy')).toBe('no-referrer');
		expect(page.headers.get('cache-control')).toBe('no-store');
		expect(await page.text()).toContain('Accept your invitation');
		for (const length of [11, 129]) {
			expect((await request('/api/auth/reset-password', 'POST', { token: secondToken, newPassword: 'x'.repeat(length) }, '')).status).toBe(400);
		}
		const newPassword = 'invited-1234';
		expect((await request('/api/auth/reset-password', 'POST', { token: secondToken, newPassword }, '')).status).toBe(200);
		expect((await request('/api/auth/reset-password', 'POST', { token: secondToken, newPassword }, '')).status).toBe(400);
		expect((await request('/api/auth/reset-password', 'POST', { token: firstToken, newPassword }, '')).status).toBe(400);
		const invitedCookie = await login(invited.email, newPassword);
		expect((await request('/api/projects', 'GET', undefined, invitedCookie)).status).toBe(200);
		expect((await request(path, 'POST', {})).status).toBe(404);
		expect((await request(path, 'PATCH', { isAdmin: true })).status).toBe(200);
		expect((await request('/api/admin/users', 'GET', undefined, invitedCookie)).status).toBe(200);
		expect((await request(path, 'PATCH', { isAdmin: false }, invitedCookie)).status).toBe(400);
		expect((await request(path, 'PATCH', { isAdmin: false })).status).toBe(200);
		expect((await request('/api/admin/users', 'GET', undefined, invitedCookie)).status).toBe(403);
		expect((await fixture.pool.query('SELECT "emailVerified" FROM "user" WHERE id = $1', [invited.id])).rows[0].emailVerified).toBe(true);
	});

	it('keeps an administrator when two administrators concurrently revoke each other', async () => {
		const users = (await (await request('/api/admin/users')).json()).users as AdminUser[];
		const owner = users.find((user) => user.email === 'owner@example.test')!;
		const outsider = users.find((user) => user.email === 'outsider@example.test')!;
		expect((await request(`/api/admin/users/${outsider.id}`, 'PATCH', { isAdmin: true })).status).toBe(200);
		try {
			const responses = await Promise.all([
				request(`/api/admin/users/${outsider.id}`, 'PATCH', { isAdmin: false }),
				request(`/api/admin/users/${owner.id}`, 'PATCH', { isAdmin: false }, outsiderCookie)
			]);
			expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
			expect((await fixture.pool.query('SELECT user_id FROM application_admins')).rowCount).toBe(1);
		} finally {
			await fixture.pool.query('INSERT INTO application_admins(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [owner.id]);
			await fixture.pool.query('DELETE FROM application_admins WHERE user_id = $1', [outsider.id]);
		}
	});

	it('reports delivery failures and preserves pending accounts for retry', async () => {
		rejected = true;
		try {
			const failed = await request('/api/admin/users', 'POST', { name: 'Retry User', email: 'retry@example.test' });
			expect(failed.status).toBe(503);
			expect((await failed.json()).message).toContain('account was created');
			const users = (await (await request('/api/admin/users')).json()).users as AdminUser[];
			const retry = users.find((user) => user.email === 'retry@example.test')!;
			expect(retry.invitedAt).toBeTruthy();
			expect(retry.sentAt).toBeNull();
			expect((await fixture.pool.query("SELECT id FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%'", [retry.id])).rowCount).toBe(0);
			expect((await request('/api/admin/email', 'POST', {})).status).toBe(503);
			rejected = false;
			expect((await request(`/api/admin/users/${retry.id}`, 'POST', {})).status).toBe(200);
		} finally { rejected = false; }
	});

	it('changes passwords with current-password proof and revokes other sessions', async () => {
		const otherSession = await login('outsider@example.test');
		expect((await request('/api/auth/change-password', 'POST', { currentPassword: 'wrong-password', newPassword: 'changed-password-value', revokeOtherSessions: true }, outsiderCookie)).status).toBe(400);
		expect((await request('/api/auth/change-password', 'POST', { currentPassword: fixture.password, newPassword: 'changed-password-value', revokeOtherSessions: true }, '', undefined)).status).toBe(401);
		const changed = await request('/api/auth/change-password', 'POST', { currentPassword: fixture.password, newPassword: 'changed-password-value', revokeOtherSessions: true }, outsiderCookie);
		expect(changed.status).toBe(200);
		const cookie = changed.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
		expect((await request('/api/projects', 'GET', undefined, cookie)).status).toBe(200);
		expect((await request('/api/projects', 'GET', undefined, otherSession)).status).toBe(401);
		expect((await request('/api/projects', 'GET', undefined, outsiderCookie)).status).toBe(401);
		outsiderCookie = cookie;
	});

	it('lets users save only their own name and exposes all user settings together', async () => {
		memberCookie = await login('member@example.test');
		expect((await request('/account', 'GET', undefined, '')).status).toBe(303);
		const page = await request('/account', 'GET', undefined, memberCookie);
		expect(page.status).toBe(200);
		const html = await page.text();
		for (const label of ['User settings', 'Your name', 'New email address', 'Change password', 'member@example.test']) expect(html).toContain(label);
		const path = '/api/account/profile';
		expect((await request(path, 'PATCH', { name: 'Renamed' }, '')).status).toBe(401);
		expect((await request(path, 'PATCH', { name: 'Renamed' }, memberCookie, 'https://wrong.test')).status).toBe(403);
		for (const name of ['', '   ', 'x'.repeat(81), 'bad\nname', 123]) {
			expect((await request(path, 'PATCH', { name }, memberCookie)).status).toBe(400);
		}
		expect((await request(path, 'PATCH', { name: 'Renamed', email: 'bypass@example.test' }, memberCookie)).status).toBe(400);
		const saved = await request(path, 'PATCH', { name: '  Renamed Member  ' }, memberCookie);
		expect(saved.status).toBe(200);
		const cookies = saved.headers.getSetCookie();
		if (cookies.length) memberCookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
		expect(await (await request('/account', 'GET', undefined, memberCookie)).text()).toContain('Renamed Member');
		expect(await (await request('/', 'GET', undefined, memberCookie)).text()).toContain('Renamed Member');
		expect((await fixture.pool.query('SELECT name FROM "user" WHERE email = $1', ['owner@example.test'])).rows[0].name).toBe('owner');
	});

	it('requires password proof, rejects invalid changes, and reports email delivery failure', async () => {
		const path = '/api/account/profile';
		const body = { email: 'new-member@example.test', currentPassword: fixture.password };
		expect((await request(path, 'POST', body, '')).status).toBe(401);
		expect((await request(path, 'POST', body, memberCookie, 'https://wrong.test')).status).toBe(403);
		expect((await request(path, 'POST', { ...body, email: 'not-an-email' }, memberCookie)).status).toBe(400);
		expect((await request(path, 'POST', { ...body, currentPassword: 'wrong-password' }, memberCookie)).status).toBe(400);
		expect((await request(path, 'POST', { ...body, email: 'owner@example.test' }, memberCookie)).status).toBe(409);
		rejected = true;
		try {
			const failed = await request(path, 'POST', body, memberCookie);
			expect(failed.status).toBe(503);
			expect((await failed.json()).message).toContain('verification email could not be sent');
			expect((await fixture.pool.query('SELECT email FROM "user" WHERE name = $1', ['Renamed Member'])).rows[0].email).toBe('member@example.test');
		} finally { rejected = false; }
		expect((await request(path, 'POST', body, memberCookie)).status).toBe(200);
		expect((await request(path, 'POST', body, memberCookie)).status).toBe(429);
	});

	it('changes the sign-in email only after verification and handles invalid or reused links', async () => {
		const decoded = messages.at(-1)!.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
		const link = decoded.match(/https?:\/\/[^\s]+\/api\/auth\/verify-email\?[^\s]+/)?.[0];
		expect(link).toBeTruthy();
		const verificationToken = new URL(link!).searchParams.get('token')!;
		const claims = JSON.parse(Buffer.from(verificationToken.split('.')[1], 'base64url').toString());
		expect(claims.exp - claims.iat).toBe(3600);
		expect(claims).toMatchObject({ email: 'member@example.test', updateTo: 'new-member@example.test', requestType: 'change-email-verification' });
		expect(decoded).toContain('new-member@example.test');
		expect(decoded).toContain('Renamed Member');
		expect(await (await request('/account', 'GET', undefined, memberCookie)).text()).toContain('member@example.test');
		expect((await request('/api/auth/change-email', 'POST', { newEmail: 'bypass@example.test' }, memberCookie)).status).toBe(403);
		const invalid = await request('/api/auth/verify-email?token=invalid&callbackURL=/account', 'GET', undefined, memberCookie);
		expect(invalid.status).toBe(302);
		expect(invalid.headers.get('location')).toContain('error=INVALID_TOKEN');
		const errorPage = await request('/account?error=INVALID_TOKEN', 'GET', undefined, memberCookie);
		expect(await errorPage.text()).toContain('verification link is invalid');
		const verified = await request(new URL(link!).pathname + new URL(link!).search, 'GET', undefined, memberCookie);
		expect(verified.status).toBe(302);
		expect(verified.headers.get('location')).toBe(`${fixture.origin}/account?emailChanged=1`);
		memberCookie = verified.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
		const verifiedPage = await request('/account?emailChanged=1', 'GET', undefined, memberCookie);
		expect(await verifiedPage.text()).toContain('Your sign-in address is now new-member@example.test');
		expect((await fixture.pool.query('SELECT email, "emailVerified" FROM "user" WHERE name = $1', ['Renamed Member'])).rows[0]).toEqual({ email: 'new-member@example.test', emailVerified: true });
		const reused = await request(new URL(link!).pathname + new URL(link!).search, 'GET', undefined, memberCookie);
		expect(reused.status).toBe(302);
		expect(reused.headers.get('location')).toContain('error=');
		await fixture.pool.query('DELETE FROM "rateLimit"');
		expect((await request('/api/auth/sign-in/email', 'POST', { email: 'member@example.test', password: fixture.password }, '')).status).toBe(401);
		memberCookie = await login('new-member@example.test');
		expect((await request('/api/projects', 'GET', undefined, memberCookie)).status).toBe(200);
	});

	it('recovers passwords without account enumeration, rejects expired links, and revokes sessions', async () => {
		// Previous reset submissions intentionally exercised the public rate limit.
		await fixture.pool.query('DELETE FROM "rateLimit"');
		await fixture.pool.query("DELETE FROM api_rate_limits WHERE key LIKE 'password-recovery-%'");
		const unknown = await request('/api/auth/request-password-reset', 'POST', { email: 'missing@example.test' }, '');
		const before = messages.length;
		const known = await request('/api/auth/request-password-reset', 'POST', { email: 'outsider@example.test' }, '');
		expect(unknown.status).toBe(200);
		expect(known.status).toBe(200);
		expect(await known.json()).toEqual(await unknown.json());
		expect(messages.length).toBe(before + 1);
		const expired = token(messages.at(-1)!);
		await fixture.pool.query('UPDATE verification SET "expiresAt" = now() - interval \'1 hour\' WHERE identifier = $1', [`reset-password:${expired}`]);
		expect((await request('/api/auth/reset-password', 'POST', { token: expired, newPassword: 'recovered-password-value' }, '')).status).toBe(400);
		expect((await request('/api/auth/request-password-reset', 'POST', { email: 'outsider@example.test' }, '')).status).toBe(200);
		const active = token(messages.at(-1)!);
		const recoveredPassword = 'r'.repeat(128);
		expect((await request('/api/auth/reset-password', 'POST', { token: active, newPassword: recoveredPassword }, '')).status).toBe(200);
		expect((await request('/api/projects', 'GET', undefined, outsiderCookie)).status).toBe(401);
		expect((await request('/api/auth/request-password-reset', 'POST', { email: 'outsider@example.test' }, '')).status).toBe(429);
		const recoveredCookie = await login('outsider@example.test', recoveredPassword);
		expect((await request('/api/projects', 'GET', undefined, recoveredCookie)).status).toBe(200);
		const current = (await (await request('/api/admin/email')).json()).settings as EmailSettings;
		expect((await request('/api/admin/email', 'PATCH', { ...current, password: '', clearPassword: true })).status).toBe(200);
		expect((await (await request('/api/admin/email')).json()).settings.passwordConfigured).toBe(false);
		expect((await fixture.pool.query('SELECT password_encrypted FROM smtp_settings')).rows[0].password_encrypted).toBe('');
	});
});
