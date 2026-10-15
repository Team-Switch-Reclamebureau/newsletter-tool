import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import { startHostedFixture } from '../helpers/hosted-fixture';
import { DEFAULT_SIGNATURE_DOWNLOAD_LINK_TEXT, type SignatureDetail, type SignatureEmailResult } from '../../src/lib/signatures';
import { encodeRichText, RICH_TEXT_PREFIX } from '../../src/lib/rich-text';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let smtp: SMTPServer;
let cookie = '';
let regularCookie = '';
const rejected = new Set<string>();
const messages: { raw: string; recipients: string[] }[] = [];
const instructions = 'Download the file below.\nOpen it in your browser and copy the signature into your email settings.';

async function request(path: string, method = 'GET', body?: unknown, session = cookie, origin?: string) {
	return fetch(`${fixture.origin}${path}`, {
		method, redirect: 'manual',
		headers: { Accept: 'application/json', Origin: origin ?? fixture.origin, ...(session ? { Cookie: session } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function login(email: string) {
	const response = await request('/api/auth/sign-in/email', 'POST', { email, password: fixture.password }, '');
	expect(response.status).toBe(200);
	return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

async function save(signature: SignatureDetail, path: string, method: string, body: Record<string, unknown>): Promise<SignatureDetail> {
	const response = await request(`/api/signatures/${signature.id}${path}`, method, { ...body, revision: signature.revision });
	expect(response.ok).toBe(true);
	return (await response.json()).signature;
}

async function ready(): Promise<SignatureDetail> {
	const response = await request('/api/signatures', 'POST', { name: 'Company signatures' });
	expect(response.status).toBe(201);
	let signature: SignatureDetail = (await response.json()).signature;
	expect(signature.instructionText).toBe('');
	expect(signature.downloadLinkText).toBe(DEFAULT_SIGNATURE_DOWNLOAD_LINK_TEXT);
	signature = await save(signature, '', 'PATCH', { instructionText: instructions });
	signature = await save(signature, '/variations', 'POST', { name: 'Standard', filename: 'standard.html', html: '<p>Standard: {{name}}</p>' });
	signature = await save(signature, '/variations', 'POST', { name: 'Compact', filename: 'compact.html', html: '<p>Compact: {{name}}</p>' });
	for (const name of ['Alice', 'Bob', 'Charlie']) {
		signature = await save(signature, '/contacts', 'POST', { fields: { name, email: `${name.toLowerCase()}@example.test` } });
	}
	return signature;
}

function send(signature: SignatureDetail, contactIds = signature.contacts.map((contact) => contact.id), session = cookie, variationId = signature.variations[0].id) {
	return request(`/api/signatures/${signature.id}/send`, 'POST', { revision: signature.revision, variationId, contactIds }, session);
}

function decoded(raw: string) {
	return raw.replace(/=\r?\n/g, '').replace(/=([A-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\r\n/g, '\n');
}

function downloadPath(raw: string): string {
	const match = decoded(raw).match(/\/signature-downloads\/[a-f0-9-]+\/signature\.html/);
	if (!match) throw new Error('No signature download link in email.');
	return match[0];
}

beforeAll(async () => {
	smtp = new SMTPServer({
		disabledCommands: ['STARTTLS'], authOptional: true,
		onRcptTo(address, _session, callback) {
			callback(rejected.has(address.address) ? Object.assign(new Error('Synthetic recipient rejection'), { responseCode: 550 }) : null);
		},
		onData(stream, session, callback) {
			let raw = '';
			stream.on('data', (chunk) => { raw += chunk.toString(); });
			stream.on('error', callback);
			stream.on('end', () => {
				messages.push({ raw, recipients: session.envelope.rcptTo.map((address) => address.address) });
				callback();
			});
		}
	});
	await new Promise<void>((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
	const address = smtp.server.address();
	if (!address || typeof address === 'string') throw new Error('No SMTP test port allocated.');
	fixture = await startHostedFixture();
	cookie = await login('owner@example.test');
	regularCookie = await login('outsider@example.test');
	const settings = (await (await request('/api/admin/email')).json()).settings;
	expect((await request('/api/admin/email', 'PATCH', {
		...settings, host: '127.0.0.1', port: address.port, security: 'none', username: '', password: '', clearPassword: false,
		fromEmail: 'sender@example.test', fromName: 'Signature tests'
	})).status).toBe(200);
});

beforeEach(async () => {
	messages.length = 0;
	rejected.clear();
	await fixture.pool.query('DELETE FROM api_rate_limits');
});

afterAll(async () => {
	if (fixture) await fixture.stop();
	if (smtp) await new Promise<void>((resolve) => smtp.close(resolve));
});

describe('signature instruction emails and private download snapshots', () => {
	it('saves a custom download link label independently and uses it safely in both email alternatives', async () => {
		let signature = await ready();
		const previous = signature;
		signature = await save(signature, '', 'PATCH', { downloadLinkText: '  Get <signature> & install  ' });
		expect(signature.downloadLinkText).toBe('Get <signature> & install');
		expect(signature.instructionText).toBe(previous.instructionText);
		expect(signature.name).toBe(previous.name);
		expect(signature.revision).toBe(previous.revision + 1);
		expect((await (await request(`/api/signatures/${signature.id}`)).json()).signature).toEqual(signature);
		expect((await request(`/api/signatures/${signature.id}`, 'PATCH', { revision: previous.revision, downloadLinkText: 'Stale' })).status).toBe(409);
		for (const downloadLinkText of [null, 123, '', ' ', 'x'.repeat(201), 'Bad\nlabel', 'Bad\0label']) {
			expect((await request(`/api/signatures/${signature.id}`, 'PATCH', { revision: signature.revision, downloadLinkText })).status).toBe(400);
		}
		expect((await (await request(`/api/signatures/${signature.id}`)).json()).signature).toEqual(signature);
		expect((await send(signature, [signature.contacts[0].id])).status).toBe(200);
		const message = decoded(messages[0].raw);
		const url = fixture.origin + downloadPath(message);
		expect(message).toContain(`Get <signature> & install:\n${url}`);
		expect(message).toContain(`<a href="${url}">Get &lt;signature&gt; &amp; install</a>`);
		expect(message).not.toContain(DEFAULT_SIGNATURE_DOWNLOAD_LINK_TEXT);
	});

	it('places the personalized link at the tag in an ordered list for each selected contact', async () => {
		let signature = await ready();
		const formatted = encodeRichText({ type: 'doc', content: [
			{ type: 'orderedList', content: [
				{ type: 'listItem', content: [{ type: 'paragraph', content: [
					{ type: 'text', text: '{{download_link}}', marks: [{ type: 'bold' }] }
				] }] },
				{ type: 'listItem', content: [{ type: 'paragraph', content: [
					{ type: 'text', text: 'Install it.', marks: [{ type: 'italic' }] }
				] }] }
			] }
		] });
		signature = await save(signature, '', 'PATCH', { instructionText: formatted, downloadLinkText: 'Get your signature' });
		const contacts = signature.contacts.slice(0, 2);
		expect((await send(signature, contacts.map((contact) => contact.id))).status).toBe(200);
		expect(messages).toHaveLength(2);
		const links = new Set<string>();
		for (const contact of contacts) {
			const message = decoded(messages.find((entry) => entry.recipients.includes(contact.fields.email))!.raw);
			const path = downloadPath(message);
			const url = fixture.origin + path;
			links.add(path);
			expect(message).toContain(`1. Get your signature (${url})\n2. Install it.`);
			expect(message).toContain(`<ol><li><a href="${url}"><strong>Get your signature</strong></a></li><li><em>Install it.</em></li></ol>`);
			expect(message.match(/<a href=/g)).toHaveLength(1);
			expect(message).not.toContain('{{download_link}}');
			const download = await request(path, 'GET', undefined, '');
			expect(download.status).toBe(200);
			expect(await download.text()).toContain(contact.fields.name);
		}
		expect(links.size).toBe(2);
	});

	it('saves instruction text independently, validates it, and rejects stale settings', async () => {
		let signature = await ready();
		const previous = signature;
		signature = await save(signature, '', 'PATCH', { instructionText: '  Updated instructions.\nSecond line.  ' });
		expect(signature.name).toBe(previous.name);
		expect(signature.instructionText).toBe('Updated instructions.\nSecond line.');
		expect(signature.revision).toBe(previous.revision + 1);
		expect((await request(`/api/signatures/${signature.id}`, 'PATCH', { revision: previous.revision, instructionText: 'Stale' })).status).toBe(409);
		for (const instructionText of [null, 123, 'x'.repeat(10001), 'bad\0text', RICH_TEXT_PREFIX + '{', RICH_TEXT_PREFIX + '{"type":"doc","content":[{"type":"script"}]}']) {
			expect((await request(`/api/signatures/${signature.id}`, 'PATCH', { revision: signature.revision, instructionText })).status).toBe(400);
		}
		expect((await (await request(`/api/signatures/${signature.id}`)).json()).signature).toEqual(signature);
		signature = await save(signature, '', 'PATCH', { instructionText: '' });
		expect((await send(signature)).status).toBe(400);
		expect(messages).toEqual([]);
	});

	it('persists formatted instructions and delivers bold, italics, and ordered lists with a plain-text alternative', async () => {
		let signature = await ready();
		const formatted = encodeRichText({ type: 'doc', content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Install your signature', marks: [{ type: 'bold' }] }] },
			{ type: 'orderedList', attrs: { start: 1, type: null }, content: [
				{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Download the file', marks: [{ type: 'bold' }] }] }] },
				{ type: 'listItem', content: [{ type: 'paragraph', content: [
					{ type: 'text', text: 'Open settings', marks: [{ type: 'italic' }] },
					{ type: 'text', text: ' <script>alert("x")</script>' }
				] }] }
			] }
		] });
		signature = await save(signature, '', 'PATCH', { instructionText: formatted });
		expect((await (await request(`/api/signatures/${signature.id}`)).json()).signature.instructionText).toBe(formatted);
		expect((await send(signature, [signature.contacts[0].id])).status).toBe(200);
		expect(messages).toHaveLength(1);
		expect(messages[0].raw).toContain('Content-Type: multipart/alternative');
		const message = decoded(messages[0].raw);
		expect(message).toContain('Content-Type: text/plain; charset=utf-8');
		expect(message).toContain('Content-Type: text/html; charset=utf-8');
		expect(message).toContain('Install your signature\n1. Download the file\n2. Open settings <script>alert("x")</script>');
		expect(message).toContain('<strong>Install your signature</strong>');
		expect(message).toContain('<ol><li><strong>Download the file</strong></li><li><em>Open settings</em> &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li></ol>');
		expect(message).toContain(`<a href="${fixture.origin}${downloadPath(message)}">Download your personalized signature.html</a>`);
		expect(message).not.toContain(RICH_TEXT_PREFIX);
		signature = await save(signature, '', 'PATCH', { instructionText: encodeRichText({ type: 'doc', content: [{ type: 'paragraph' }] }) });
		expect(signature.instructionText).toBe('');
		expect((await send(signature)).status).toBe(400);
		expect(messages).toHaveLength(1);
	});

	it('emails only selected contacts, with one private link each for the selected variation', async () => {
		const signature = await ready();
		const contacts = signature.contacts.slice(0, 2);
		const variation = signature.variations.find((entry) => entry.name === 'Standard')!;
		const response = await send(signature, contacts.map((contact) => contact.id), regularCookie, variation.id);
		expect(response.status).toBe(200);
		const result: SignatureEmailResult = await response.json();
		expect(result.accepted).toEqual(contacts.map((contact) => contact.id));
		expect(result.failed).toEqual([]);
		expect(messages).toHaveLength(2);
		const paths = new Set<string>();
		for (const contact of contacts) {
			const message = messages.find((entry) => entry.recipients.includes(contact.fields.email))!;
			expect(message.recipients).toEqual([contact.fields.email]);
			expect(decoded(message.raw)).toContain(instructions);
			expect(decoded(message.raw)).toContain(`Subject: Your email signature - ${signature.name}`);
			expect(decoded(message.raw)).toContain(fixture.origin);
			expect(decoded(message.raw)).not.toContain(signature.contacts[2].fields.email);
			const path = downloadPath(message.raw);
			paths.add(path);
			const download = await request(path, 'GET', undefined, '');
			expect(download.status).toBe(200);
			expect(download.headers.get('content-type')).toBe('text/html; charset=utf-8');
			expect(download.headers.get('content-disposition')).toBe('inline; filename="signature.html"');
			expect(download.headers.get('cache-control')).toContain('no-store');
			expect(download.headers.get('content-security-policy')).toContain('sandbox');
			expect(download.headers.get('referrer-policy')).toBe('no-referrer');
			expect(download.headers.get('x-robots-tag')).toContain('noindex');
			expect(await download.text()).toBe(`<p>Standard: ${contact.fields.name}</p>`);
		}
		expect(paths.size).toBe(2);
		expect((await (await request(`/api/signatures/${signature.id}`)).json()).signature).toEqual(signature);
	});

	it('keeps emailed snapshots after edits or contact/variation deletion, but removes them with the signature', async () => {
		let signature = await ready();
		const contact = signature.contacts[0];
		const variation = signature.variations[0];
		expect((await send(signature, [contact.id])).status).toBe(200);
		const path = downloadPath(messages[0].raw);
		const original = await (await request(path, 'GET', undefined, '')).text();
		signature = await save(signature, `/contacts/${contact.id}`, 'PATCH', { fields: { ...contact.fields, name: 'Changed' } });
		signature = await save(signature, `/variations/${variation.id}`, 'PATCH', { name: variation.name, filename: variation.filename, html: '<p>Changed {{name}}</p>' });
		signature = await save(signature, '', 'PATCH', { instructionText: 'Changed instructions' });
		await fixture.pool.query("UPDATE signature_downloads SET created_at = now() - interval '5 years' WHERE signature_id = $1", [signature.id]);
		expect(await (await request(path, 'GET', undefined, '')).text()).toBe(original);
		signature = await save(signature, `/contacts/${contact.id}`, 'DELETE', {});
		signature = await save(signature, `/variations/${variation.id}`, 'DELETE', {});
		expect(await (await request(path, 'GET', undefined, '')).text()).toBe(original);
		expect((await request(`/api/signatures/${signature.id}`, 'DELETE', { revision: signature.revision, confirmName: signature.name })).status).toBe(200);
		expect((await request(path, 'GET', undefined, '')).status).toBe(404);
		expect((await fixture.pool.query('SELECT id FROM signature_downloads WHERE signature_id = $1', [signature.id])).rows).toEqual([]);
	});

	it('rejects unauthenticated, cross-origin, draft, stale, and invalid selections without sending', async () => {
		const signature = await ready();
		const body = { revision: signature.revision, variationId: signature.variations[0].id, contactIds: [signature.contacts[0].id] };
		const path = `/api/signatures/${signature.id}/send`;
		expect((await send(signature, body.contactIds, '')).status).toBe(401);
		expect((await request(path, 'POST', body, cookie, 'https://wrong.test')).status).toBe(403);
		for (const patch of [
			{ instructionText: 'Draft injection' }, { downloadLinkText: 'Draft label' }, { recipients: ['injected@example.test'] }, { html: '<p>Draft</p>' },
			{ contactIds: [] }, { contactIds: 'all' }, { contactIds: [null] }, { variationId: 'invalid' }, { revision: 0 }
		]) {
			expect((await request(path, 'POST', { ...body, ...patch })).status).toBe(400);
		}
		expect((await request(path, 'POST', { ...body, revision: signature.revision - 1 })).status).toBe(409);
		expect(messages).toEqual([]);
		expect((await fixture.pool.query('SELECT id FROM signature_downloads WHERE signature_id = $1', [signature.id])).rows).toEqual([]);
	});

	it('rejects contacts and variations from another signature and preflights every contact before any delivery', async () => {
		const signature = await ready();
		const other = await ready();
		expect((await send(signature, [other.contacts[0].id])).status).toBe(404);
		expect((await send(signature, [signature.contacts[0].id], cookie, other.variations[0].id)).status).toBe(404);
		const invalid = signature.contacts[1];
		await fixture.pool.query('UPDATE signature_contacts SET fields = $2 WHERE id = $1', [invalid.id, { name: 'Legacy without email' }]);
		expect((await send(signature, [signature.contacts[0].id, invalid.id])).status).toBe(400);
		await fixture.pool.query('UPDATE signature_contacts SET fields = $2 WHERE id = $1', [invalid.id, { email: 'legacy@example.test' }]);
		expect((await send(signature, [signature.contacts[0].id, invalid.id])).status).toBe(400);
		expect(messages).toEqual([]);
		expect((await fixture.pool.query('SELECT id FROM signature_downloads WHERE signature_id = $1', [signature.id])).rows).toEqual([]);
	});

	it('deduplicates contact IDs and rejects unknown or malformed public links', async () => {
		const signature = await ready();
		const id = signature.contacts[0].id;
		expect((await send(signature, [id, id])).status).toBe(200);
		expect(messages).toHaveLength(1);
		expect((await request(`/signature-downloads/${randomUUID()}/signature.html`, 'GET', undefined, '')).status).toBe(404);
		expect((await request('/signature-downloads/invalid/signature.html', 'GET', undefined, '')).status).toBe(404);
	});

	it('reports partial SMTP failures by contact and allows retrying only failed contacts', async () => {
		const signature = await ready();
		const [first, second] = signature.contacts;
		rejected.add(second.fields.email);
		const response = await send(signature, [first.id, second.id]);
		expect(response.status).toBe(207);
		const result: SignatureEmailResult = await response.json();
		expect(result.accepted).toEqual([first.id]);
		expect(result.failed).toEqual([second.id]);
		expect(result.message).toContain('not confirmed');
		expect(messages).toHaveLength(1);
		rejected.clear();
		expect((await send(signature, result.failed)).status).toBe(200);
		expect(messages).toHaveLength(2);
		expect(messages[1].recipients).toEqual([second.fields.email]);
	});

	it('does not report success when SMTP rejects every selected contact or is not configured', async () => {
		const signature = await ready();
		for (const contact of signature.contacts) rejected.add(contact.fields.email);
		const response = await send(signature);
		expect(response.status).toBe(207);
		const result: SignatureEmailResult = await response.json();
		expect(result.accepted).toEqual([]);
		expect(result.failed).toEqual(signature.contacts.map((contact) => contact.id));
		expect(messages).toEqual([]);
		await fixture.pool.query("UPDATE smtp_settings SET host = ''");
		try { expect((await send(signature)).status).toBe(503); }
		finally { await fixture.pool.query("UPDATE smtp_settings SET host = '127.0.0.1'"); }
	});

	it('rate-limits repeated sends', async () => {
		const signature = await ready();
		for (let index = 0; index < 5; index++) expect((await send(signature, [signature.contacts[0].id])).status).toBe(200);
		expect((await send(signature, [signature.contacts[0].id])).status).toBe(429);
		expect(messages).toHaveLength(5);
	});
});
