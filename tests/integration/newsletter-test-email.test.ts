import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { createItem, createNewsletter, type Newsletter } from '../../src/lib/newsletters';
import { DEFAULT_ITEM_SNIPPET, DEFAULT_TEMPLATE, type RemoteProject } from '../../src/lib/remote';
import { startHostedFixture } from '../helpers/hosted-fixture';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let smtp: SMTPServer;
let ownerCookie = '';
let memberCookie = '';
let outsiderCookie = '';
let ownerId = '';
let project: RemoteProject;
let newsletter: Newsletter;
let otherNewsletterId = '';
let permalink = '';
let rejectData = false;
const rejectedRecipients = new Set<string>();
const messages: { raw: string; recipients: string[] }[] = [];

async function request(path: string, method = 'GET', body?: unknown, cookie = ownerCookie, origin?: string) {
	return fetch(`${fixture.origin}${path}`, {
		method, redirect: 'manual',
		headers: { Accept: 'application/json', Origin: origin ?? fixture.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function login(email: string) {
	const response = await request('/api/auth/sign-in/email', 'POST', { email, password: fixture.password }, '');
	expect(response.status).toBe(200);
	return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

function recipientsPath() { return `/api/projects/${project.id}/test-recipients`; }
function sendPath(id = newsletter.id) { return `/api/projects/${project.id}/newsletters/${id}/test-email`; }

async function saveRecipients(recipients: string, cookie = ownerCookie) {
	const settings = (await (await request(recipientsPath(), 'GET', undefined, cookie)).json()).settings;
	const response = await request(recipientsPath(), 'PATCH', { recipients, revision: settings.revision }, cookie);
	expect(response.status).toBe(200);
	return (await response.json()).settings;
}

async function sendTest(id = newsletter.id, cookie = ownerCookie, origin?: string) {
	const settings = (await (await request(recipientsPath())).json()).settings;
	return request(sendPath(id), 'POST', { recipientsRevision: settings.revision }, cookie, origin);
}

function decodeMessage(raw: string) {
	return raw.replace(/=\r?\n/g, '').replace(/=([A-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\r\n/g, '\n');
}

beforeAll(async () => {
	smtp = new SMTPServer({
		disabledCommands: ['STARTTLS'], authOptional: true,
		onRcptTo(address, _session, callback) {
			callback(rejectedRecipients.has(address.address) ? Object.assign(new Error('Synthetic recipient rejection'), { responseCode: 550 }) : null);
		},
		onData(stream, session, callback) {
			let raw = '';
			stream.on('data', (chunk) => { raw += chunk.toString(); });
			stream.on('error', callback);
			stream.on('end', () => {
				if (rejectData) callback(Object.assign(new Error('Synthetic delivery failure'), { responseCode: 554 }));
				else { messages.push({ raw, recipients: session.envelope.rcptTo.map((address) => address.address) }); callback(); }
			});
		}
	});
	await new Promise<void>((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
	const address = smtp.server.address();
	if (!address || typeof address === 'string') throw new Error('No test SMTP port allocated.');
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	memberCookie = await login('member@example.test');
	outsiderCookie = await login('outsider@example.test');
	ownerId = (await fixture.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', ['owner@example.test'])).rows[0].id;
	project = (await (await request('/api/projects', 'POST', {
		name: 'Newsletter tests', template: DEFAULT_TEMPLATE.replace('{{items}}', '<mj-section><mj-column><mj-text>Saved template note</mj-text></mj-column></mj-section>{{items}}'),
		itemTemplate: DEFAULT_ITEM_SNIPPET
	})).json()).project;
	expect((await request(`/api/projects/${project.id}/members`, 'POST', { email: 'member@example.test' })).status).toBe(200);
	newsletter = createNewsletter('Saved October edition');
	newsletter.items = [{ ...createItem(), fields: { title: 'Saved newsletter title', text: 'Saved newsletter body', url: 'https://example.test/story?existing=1#fragment', button: 'Read saved story' } }];
	newsletter.utm.utm_source = 'newsletter-test';
	const saved = await request(`/api/projects/${project.id}/newsletters`, 'POST', { newsletter });
	expect(saved.status).toBe(201);
	permalink = (await saved.json()).permalink;
	const other = (await (await request('/api/projects', 'POST', { name: 'Other project' }, outsiderCookie)).json()).project as RemoteProject;
	const otherNewsletter = createNewsletter('Other edition');
	expect((await request(`/api/projects/${other.id}/newsletters`, 'POST', { newsletter: otherNewsletter }, outsiderCookie)).status).toBe(201);
	otherNewsletterId = otherNewsletter.id;
	const settings = (await (await request('/api/admin/email')).json()).settings;
	expect((await request('/api/admin/email', 'PATCH', {
		...settings, host: '127.0.0.1', port: address.port, security: 'none', username: '', password: '', clearPassword: false,
		fromEmail: 'sender@example.test', fromName: 'Newsletter tests'
	})).status).toBe(200);
});

beforeEach(async () => {
	messages.length = 0;
	rejectedRecipients.clear();
	rejectData = false;
	await fixture.pool.query('DELETE FROM api_rate_limits');
});

afterAll(async () => {
	if (fixture) await fixture.stop();
	if (smtp) await new Promise<void>((resolve) => smtp.close(resolve));
});

describe('saved newsletter test emails through PostgreSQL and real SMTP', () => {
	it('persists a shared project list and protects concurrent edits and project access', async () => {
		expect((await request(recipientsPath(), 'GET', undefined, '')).status).toBe(401);
		expect((await request(recipientsPath(), 'GET', undefined, outsiderCookie)).status).toBe(404);
		expect((await (await request(recipientsPath())).json()).settings).toEqual({ recipients: [], revision: 1 });
		expect((await request(recipientsPath(), 'PATCH', { recipients: 'alice@example.test', revision: 1 }, ownerCookie, 'https://wrong.test')).status).toBe(403);
		const saved = await saveRecipients('ALICE@example.test, bob@example.test, alice@example.test');
		expect(saved).toEqual({ recipients: ['alice@example.test', 'bob@example.test'], revision: 2 });
		expect((await (await request(recipientsPath(), 'GET', undefined, memberCookie)).json()).settings).toEqual(saved);
		expect((await request(recipientsPath(), 'PATCH', { recipients: 'other@example.test', revision: 1 }, memberCookie)).status).toBe(409);
		expect((await saveRecipients('member@example.test', memberCookie)).recipients).toEqual(['member@example.test']);
		expect((await (await request(recipientsPath())).json()).settings.recipients).toEqual(['member@example.test']);
		const stored = (await fixture.pool.query('SELECT recipients FROM project_test_recipients WHERE project_id = $1', [project.id])).rows[0];
		expect(stored.recipients).toEqual(['member@example.test']);
	});

	it('rejects invalid lists and draft injection and supports clearing recipients', async () => {
		const settings = await saveRecipients('');
		expect(settings.recipients).toEqual([]);
		expect((await sendTest()).status).toBe(400);
		expect((await request(sendPath(), 'POST', {})).status).toBe(400);
		for (const recipients of ['not-an-email', 'a@example.test,', Array.from({ length: 21 }, (_, index) => `r${index}@example.test`).join(', ')]) {
			expect((await request(recipientsPath(), 'PATCH', { recipients, revision: settings.revision })).status).toBe(400);
		}
		expect((await request(recipientsPath(), 'PATCH', { recipients: 'a@example.test', revision: settings.revision, userId: ownerId })).status).toBe(400);
		expect((await request(sendPath(), 'POST', { recipients: 'a@example.test', newsletter })).status).toBe(400);
		expect((await (await request(recipientsPath())).json()).settings).toEqual(settings);
		expect(messages).toEqual([]);
	});

	it('sends the exact saved HTML with tracking privately to each saved recipient', async () => {
		await saveRecipients('alice@example.test, bob@example.test');
		const response = await sendTest();
		expect(response.status).toBe(200);
		expect((await response.json()).accepted).toEqual(['alice@example.test', 'bob@example.test']);
		const exported = await fetch(permalink);
		expect(exported.status).toBe(200);
		const html = (await exported.text()).replace(/\r\n/g, '\n');
		expect(messages).toHaveLength(2);
		for (const recipient of ['alice@example.test', 'bob@example.test']) {
			const message = messages.find((item) => item.recipients[0] === recipient)!;
			expect(message.recipients).toEqual([recipient]);
			const decoded = decodeMessage(message.raw);
			expect(decoded).toContain(`To: ${recipient}`);
			expect(decoded).toContain('Subject: [Test] Saved October edition');
			expect(decoded).toContain('Content-Type: text/html');
			expect(decoded).toContain(html);
			expect(decoded).toContain('Saved template note');
			expect(decoded).toContain('utm_source=newsletter-test');
			expect(decoded).not.toContain('data-newsletter-field');
			expect(decoded).not.toContain(recipient === 'alice@example.test' ? 'bob@example.test' : 'alice@example.test');
		}
	});

	it('accepts twenty recipients but rejects a twenty-first without changing the saved list', async () => {
		const recipients = Array.from({ length: 20 }, (_, index) => `reader${index}@example.test`);
		const settings = await saveRecipients(recipients.join(', '));
		expect((await request(recipientsPath(), 'PATCH', { recipients: [...recipients, 'extra@example.test'].join(', '), revision: settings.revision })).status).toBe(400);
		const response = await sendTest();
		expect(response.status).toBe(200);
		expect((await response.json()).accepted).toEqual(recipients);
		expect(messages).toHaveLength(20);
	});

	it('reports partial delivery explicitly without exposing another recipient in a message', async () => {
		await saveRecipients('alice@example.test, bob@example.test');
		rejectedRecipients.add('bob@example.test');
		const response = await sendTest();
		expect(response.status).toBe(207);
		const result = await response.json();
		expect(result.accepted).toEqual(['alice@example.test']);
		expect(result.failed).toEqual(['bob@example.test']);
		expect(result.message).toContain('Check SMTP logs before retrying');
		expect(messages).toHaveLength(1);
		expect(decodeMessage(messages[0].raw)).not.toContain('bob@example.test');
	});

	it('reports complete SMTP failure rather than claiming success', async () => {
		await saveRecipients('alice@example.test');
		rejectData = true;
		const response = await sendTest();
		expect(response.status).toBe(503);
		expect((await response.json()).message).toContain('did not confirm');
		expect(messages).toEqual([]);
	});

	it('blocks unconfigured SMTP and invalid saved HTML before delivering anything', async () => {
		await saveRecipients('alice@example.test');
		await fixture.pool.query("UPDATE smtp_settings SET host = ''");
		try {
			const unavailable = await sendTest();
			expect(unavailable.status).toBe(503);
			expect((await unavailable.json()).message).toContain('configure SMTP');
		} finally { await fixture.pool.query("UPDATE smtp_settings SET host = '127.0.0.1'"); }
		await fixture.pool.query('UPDATE projects SET template = $1 WHERE id = $2', [project.template.replace('{{items}}', '<mj-unsupported />{{items}}'), project.id]);
		try {
			expect((await sendTest()).status).toBe(422);
			expect((await fetch(permalink)).status).toBe(422);
		} finally { await fixture.pool.query('UPDATE projects SET template = $1 WHERE id = $2', [project.template, project.id]); }
		expect(messages).toEqual([]);
	});

	it('rejects unauthenticated, cross-origin, foreign and deleted editions', async () => {
		await saveRecipients('alice@example.test');
		expect((await sendTest(newsletter.id, '')).status).toBe(401);
		expect((await sendTest(newsletter.id, outsiderCookie)).status).toBe(404);
		expect((await sendTest(newsletter.id, ownerCookie, 'https://wrong.test')).status).toBe(403);
		expect((await sendTest(otherNewsletterId)).status).toBe(404);
		expect((await sendTest(crypto.randomUUID())).status).toBe(404);
		await fixture.pool.query('UPDATE newsletters SET deleted_at = now() WHERE id = $1', [newsletter.id]);
		try { expect((await sendTest()).status).toBe(404); }
		finally { await fixture.pool.query('UPDATE newsletters SET deleted_at = NULL WHERE id = $1', [newsletter.id]); }
		expect(messages).toEqual([]);
	});

	it('requires reloading before sending when another member changes recipients', async () => {
		const previous = await saveRecipients('alice@example.test');
		await saveRecipients('bob@example.test', memberCookie);
		const stale = await request(sendPath(), 'POST', { recipientsRevision: previous.revision });
		expect(stale.status).toBe(409);
		expect((await stale.json()).message).toContain('changed elsewhere');
		expect(messages).toEqual([]);
		const current = await sendTest();
		expect(current.status).toBe(200);
		expect((await current.json()).accepted).toEqual(['bob@example.test']);
	});

	it('allows the fifth send and blocks the sixth within one minute before SMTP', async () => {
		await saveRecipients('alice@example.test');
		await fixture.pool.query(`
			INSERT INTO api_rate_limits(key, window_start, attempts)
			SELECT unnest($1::text[]), now(), 4
			ON CONFLICT (key) DO UPDATE SET window_start = now(), attempts = 4`,
			[[`newsletter-test-user:${ownerId}`, `newsletter-test-project:${project.id}`]]);
		expect((await sendTest()).status).toBe(200);
		expect((await sendTest()).status).toBe(429);
		expect(messages).toHaveLength(1);
	});
});
