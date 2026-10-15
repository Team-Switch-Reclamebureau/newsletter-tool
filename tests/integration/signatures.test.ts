import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startHostedFixture } from '../helpers/hosted-fixture';
import type { SignatureDetail } from '../../src/lib/signatures';
import { MAX_TEMPLATE_BYTES } from '../../src/lib/remote';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let ownerCookie: string;
let outsiderCookie: string;

async function request(path: string, method = 'GET', body?: unknown, cookie = ownerCookie, origin = fixture.origin) {
	return fetch(`${fixture.origin}${path}`, {
		method, redirect: 'manual',
		headers: { Accept: 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function login(email: string) {
	const response = await request('/api/auth/sign-in/email', 'POST', { email, password: fixture.password }, '');
	expect(response.status).toBe(200);
	return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

async function create(name: string, cookie = ownerCookie): Promise<SignatureDetail> {
	const response = await request('/api/signatures', 'POST', { name }, cookie);
	expect(response.status).toBe(201);
	return (await response.json()).signature;
}

async function variation(signature: SignatureDetail, name: string, html: string, cookie = ownerCookie): Promise<SignatureDetail> {
	const response = await request(`/api/signatures/${signature.id}/variations`, 'POST', { name, filename: `${name}.html`, html, revision: signature.revision }, cookie);
	expect(response.status).toBe(201);
	return (await response.json()).signature;
}

async function contact(signature: SignatureDetail, fields: Record<string, string>, cookie = ownerCookie): Promise<SignatureDetail> {
	const response = await request(`/api/signatures/${signature.id}/contacts`, 'POST', { fields, revision: signature.revision }, cookie);
	expect(response.status).toBe(201);
	return (await response.json()).signature;
}

function renderPath(signature: SignatureDetail, variationId = signature.variations[0].id, contactId = signature.contacts[0].id) {
	return `/api/signatures/${signature.id}/render?variationId=${variationId}&contactId=${contactId}`;
}

beforeAll(async () => {
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	outsiderCookie = await login('outsider@example.test');
});
afterAll(async () => { if (fixture) await fixture.stop(); });

describe('email signatures', () => {
	it('migrates existing private signatures to shared content without losing variations or contacts', async () => {
		const client = await fixture.pool.connect();
		const signatureId = randomUUID();
		const variationId = randomUUID();
		const contactId = randomUUID();
		try {
			await client.query('BEGIN');
			await client.query('CREATE SCHEMA legacy_workspace_migration');
			await client.query('SET LOCAL search_path = legacy_workspace_migration');
			await client.query('CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE project_members (project_id uuid, user_id text)');
			await client.query(await readFile(new URL('../../migrations/017-email-signatures.sql', import.meta.url), 'utf8'));
			await client.query('INSERT INTO "user"(id) VALUES ($1)', ['legacy-creator']);
			await client.query('INSERT INTO email_signatures(id, user_id, name, revision) VALUES ($1,$2,$3,7)', [signatureId, 'legacy-creator', 'Existing signature']);
			await client.query('INSERT INTO signature_variations(id, signature_id, name, filename, html) VALUES ($1,$2,$3,$4,$5)', [variationId, signatureId, 'Existing variation', 'existing.html', '<p>{{name}}</p>']);
			await client.query('INSERT INTO signature_contacts(id, signature_id, fields) VALUES ($1,$2,$3)', [contactId, signatureId, { name: 'Existing contact' }]);
			await client.query('INSERT INTO project_members(project_id, user_id) VALUES ($1,$2)', [randomUUID(), 'legacy-creator']);
			await client.query(await readFile(new URL('../../migrations/018-shared-workspace.sql', import.meta.url), 'utf8'));
			expect((await client.query('SELECT id, name, revision, created_by FROM email_signatures')).rows).toEqual([{ id: signatureId, name: 'Existing signature', revision: 7, created_by: 'legacy-creator' }]);
			expect((await client.query("SELECT to_regclass('legacy_workspace_migration.project_members') AS table_name")).rows[0].table_name).toBeNull();
			await client.query('DELETE FROM "user" WHERE id = $1', ['legacy-creator']);
			expect((await client.query('SELECT created_by FROM email_signatures')).rows).toEqual([{ created_by: null }]);
			expect((await client.query('SELECT id, html FROM signature_variations')).rows).toEqual([{ id: variationId, html: '<p>{{name}}</p>' }]);
			expect((await client.query('SELECT id, fields FROM signature_contacts')).rows).toEqual([{ id: contactId, fields: { name: 'Existing contact' } }]);
		} finally {
			await client.query('ROLLBACK');
			client.release();
		}
	});

	it('separates signatures from newsletters in the sidebar and requires a session', async () => {
		expect((await request('/signatures', 'GET', undefined, '')).status).toBe(303);
		expect((await request('/api/signatures', 'GET', undefined, '')).status).toBe(401);
		expect((await request('/api/signatures', 'POST', { name: 'Rejected' }, ownerCookie, 'https://wrong.test')).status).toBe(403);
		const response = await request('/');
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('NEWSLETTERS');
		expect(html).toContain('SIGNATURES');
		expect(html).toContain('href="/signatures?new=1"');
		const signaturePage = await request('/signatures');
		expect(signaturePage.status).toBe(200);
		const signatureHtml = await signaturePage.text();
		expect(signatureHtml).toContain('href="/?new=1"');
		expect(signatureHtml).toContain('class="workspace"');
		expect(signatureHtml).toContain('aria-label="Breadcrumb"');
	});

	it('renders separate HTML variations for multiple contacts and applies contact changes to every variation', async () => {
		let signature = await create('Company signatures');
		signature = await variation(signature, 'Standard', '<table><tr><td>{{ name }}</td><td><a href="tel:{{ phone }}">{{phone}}</a></td></tr></table>');
		signature = await variation(signature, 'Compact', '<p>{{name}} / {{ phone }} / {{email}}</p>');
		signature = await contact(signature, { name: 'Jane & John', phone: '+31 123', email: 'jane@example.test' });
		signature = await contact(signature, { name: 'Alex', phone: '+31 456', email: 'alex@example.test' });
		expect(signature.revision).toBe(5);
		expect(signature.variations).toHaveLength(2);
		expect(signature.contacts).toHaveLength(2);
		for (const savedContact of signature.contacts) {
			for (const savedVariation of signature.variations) {
				const response = await request(renderPath(signature, savedVariation.id, savedContact.id));
				expect(response.status).toBe(200);
				expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
				expect(response.headers.get('content-disposition')).toContain('attachment; filename=');
				expect(response.headers.get('cache-control')).toBe('no-store');
				expect(response.headers.get('content-security-policy')).toContain('sandbox');
				const html = await response.text();
				expect(html).toContain(savedContact.fields.phone);
				expect(html).not.toContain('{{');
			}
		}
		const jane = signature.contacts.find((entry) => entry.fields.name === 'Jane & John')!;
		const update = await request(`/api/signatures/${signature.id}/contacts/${jane.id}`, 'PATCH', { revision: signature.revision, fields: { ...jane.fields, name: 'Updated <Jane>', phone: '+31 999' } });
		expect(update.status).toBe(200);
		signature = (await update.json()).signature;
		for (const savedVariation of signature.variations) {
			const html = await (await request(renderPath(signature, savedVariation.id, jane.id))).text();
			expect(html).toContain('Updated &lt;Jane&gt;');
			expect(html).toContain('+31 999');
		}
		const saved = (await (await request(`/api/signatures/${signature.id}`)).json()).signature;
		expect(saved).toEqual(signature);
		const signaturePage = await request(`/signatures?signature=${signature.id}`);
		expect(signaturePage.status).toBe(200);
		const signatureHtml = await signaturePage.text();
		expect(signatureHtml).toContain('aria-label="Signature views"');
		expect(signatureHtml).toContain('class="view-tabs');
		expect(signatureHtml).toContain('aria-hidden="true"');
	});

	it('shares signatures across all users while keeping contacts and variations scoped to their signature', async () => {
		let first = await create('First');
		first = await variation(first, 'One', '<p>{{name}}</p>');
		first = await contact(first, { name: 'First contact', email: 'first@example.test' });
		let second = await create('Second');
		second = await variation(second, 'Two', '<p>{{name}}</p>');
		second = await contact(second, { name: 'Second contact', email: 'second@example.test' });
		const outsider = await create('Another user signature', outsiderCookie);
		const listed = (await (await request('/api/signatures')).json()).signatures;
		expect(listed.some((entry: SignatureDetail) => entry.id === outsider.id)).toBe(true);
		expect((await request(`/api/signatures/${first.id}`, 'GET', undefined, outsiderCookie)).status).toBe(200);
		expect((await request(renderPath(first), 'GET', undefined, outsiderCookie)).status).toBe(200);
		expect((await request(`/signatures?signature=${first.id}`, 'GET', undefined, outsiderCookie)).status).toBe(200);
		expect((await request(renderPath(first, first.variations[0].id, second.contacts[0].id))).status).toBe(404);
		expect((await request(renderPath(first, second.variations[0].id))).status).toBe(404);
		expect((await request(`/api/signatures/${first.id}/contacts/${second.contacts[0].id}`, 'PATCH', { fields: { name: 'Wrong signature', email: 'wrong@example.test' }, revision: first.revision })).status).toBe(404);
		expect((await request(`/api/signatures/${first.id}/variations/${second.variations[0].id}`, 'DELETE', { revision: first.revision })).status).toBe(404);
		expect((await request(`/api/signatures/${first.id}/contacts`, 'POST', { fields: { name: 'Added by another user', email: 'another@example.test' }, revision: first.revision }, outsiderCookie)).status).toBe(201);
		expect((await request(`/api/signatures/${first.id}`, 'DELETE', { confirmName: first.name, revision: first.revision }, outsiderCookie)).status).toBe(403);
		expect((await request(`/api/signatures/${first.id}/render?variationId=invalid&contactId=${first.contacts[0].id}`)).status).toBe(400);
		expect((await request(`/api/signatures/${randomUUID()}`)).status).toBe(404);
	});

	it('validates uploads and contacts, preserves revisions on failure, and rejects stale writes', async () => {
		let signature = await create('Validation');
		for (const html of [' ', '<script>alert(1)</script>', '<p>{{{name}}}</p>', '<a href={{name}}>Link</a>', '{{#if phone}}Unclosed', '{{else}}', 'x'.repeat(MAX_TEMPLATE_BYTES + 1)]) {
			expect((await request(`/api/signatures/${signature.id}/variations`, 'POST', { name: 'Invalid', filename: 'invalid.html', html, revision: signature.revision })).status).toBe(400);
		}
		expect((await request(`/api/signatures/${signature.id}/variations`, 'POST', { name: 'Invalid', filename: 'invalid.mjml', html: '<p>{{name}}</p>', revision: 1 })).status).toBe(400);
		expect((await request(`/api/signatures/${signature.id}/contacts`, 'POST', { fields: { phone: '123' }, revision: 1 })).status).toBe(400);
		signature = await variation(signature, 'Valid', '<p>{{name}}</p>');
		expect(signature.revision).toBe(2);
		expect((await request(`/api/signatures/${signature.id}/variations`, 'POST', { name: 'Valid', filename: 'valid.html', html: '<p>Duplicate</p>', revision: 2 })).status).toBe(400);
		expect((await request(`/api/signatures/${signature.id}`, 'PATCH', { name: 'Stale', revision: 1 })).status).toBe(409);
		expect((await request(`/api/signatures/${signature.id}/contacts`, 'POST', { fields: { name: 'Stale' }, revision: 1 })).status).toBe(409);
		const update = await request(`/api/signatures/${signature.id}`, 'PATCH', { name: 'Renamed', revision: 2 });
		expect(update.status).toBe(200);
		signature = (await update.json()).signature;
		expect(signature.name).toBe('Renamed');
		expect(signature.revision).toBe(3);
		const replace = await request(`/api/signatures/${signature.id}/variations/${signature.variations[0].id}`, 'PATCH', { name: 'Updated', filename: 'replacement.html', html: '<p>{{name}} {{phone}}</p>', revision: signature.revision });
		expect(replace.status).toBe(200);
		signature = (await replace.json()).signature;
		signature = await contact(signature, { name: 'Jane', email: 'jane@example.test' });
		expect((await request(renderPath(signature))).status).toBe(400);
	});

	it('requires and persists email without an email placeholder and preserves saved contacts on invalid updates', async () => {
		let signature = await create('Contact emails');
		signature = await variation(signature, 'Name only', '<p>{{name}}</p>');
		for (const email of [undefined, '', 'invalid', 'jane@example']) {
			const response = await request(`/api/signatures/${signature.id}/contacts`, 'POST', { revision: signature.revision, fields: { name: 'Jane', email } });
			expect(response.status).toBe(400);
			expect((await response.json()).message).toBe('Enter a valid contact email address.');
		}
		signature = await contact(signature, { name: 'Jane', email: ' jane@example.test ' });
		expect(signature.revision).toBe(3);
		expect(signature.contacts[0].fields).toEqual({ name: 'Jane', email: 'jane@example.test' });
		for (const email of [undefined, '', 'invalid']) {
			expect((await request(`/api/signatures/${signature.id}/contacts/${signature.contacts[0].id}`, 'PATCH', { revision: signature.revision, fields: { name: 'Changed', email } })).status).toBe(400);
		}
		const saved = (await (await request(`/api/signatures/${signature.id}`)).json()).signature;
		expect(saved).toEqual(signature);
		expect(await (await request(renderPath(signature))).text()).toBe('<p>Jane</p>');
		const update = await request(`/api/signatures/${signature.id}/contacts/${signature.contacts[0].id}`, 'PATCH', { revision: signature.revision, fields: { name: 'Jane', email: 'new@example.test' } });
		expect(update.status).toBe(200);
		expect((await update.json()).signature.contacts[0].fields.email).toBe('new@example.test');
	});

	it('preserves legacy contacts without email for downloads and requires email when editing them', async () => {
		let signature = await create('Legacy contact emails');
		signature = await variation(signature, 'Name only', '<p>{{name}}</p>');
		const id = randomUUID();
		await fixture.pool.query('INSERT INTO signature_contacts(id, signature_id, fields) VALUES ($1, $2, $3)', [id, signature.id, { name: 'Legacy contact' }]);
		expect(await (await request(renderPath(signature, signature.variations[0].id, id))).text()).toBe('<p>Legacy contact</p>');
		expect((await request(`/api/signatures/${signature.id}/contacts/${id}`, 'PATCH', { revision: signature.revision, fields: { name: 'Legacy contact' } })).status).toBe(400);
		const update = await request(`/api/signatures/${signature.id}/contacts/${id}`, 'PATCH', { revision: signature.revision, fields: { name: 'Legacy contact', email: 'legacy@example.test' } });
		expect(update.status).toBe(200);
		expect((await update.json()).signature.contacts[0].fields.email).toBe('legacy@example.test');
	});

	it('does not export active URLs from contact fields and escapes HTML values', async () => {
		let signature = await create('Escaping');
		signature = await variation(signature, 'Link', '<p>{{name}}</p><a href="{{website}}">Website</a>');
		signature = await contact(signature, { name: '<img src=x onerror=alert(1)>', email: 'jane@example.test', website: 'javascript:alert(1)' });
		expect((await request(renderPath(signature))).status).toBe(400);
		const update = await request(`/api/signatures/${signature.id}/contacts/${signature.contacts[0].id}`, 'PATCH', { revision: signature.revision, fields: { name: '<img src=x onerror=alert(1)>', email: 'jane@example.test', website: 'https://example.test/?a=1&b=2' } });
		expect(update.status).toBe(200);
		signature = (await update.json()).signature;
		const html = await (await request(renderPath(signature))).text();
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).toContain('https://example.test/?a=1&amp;b=2');
	});

	it('renders conditional signature variations for each contact and updates branches when contact values change', async () => {
		let signature = await create('Conditional signatures');
		signature = await variation(signature, 'Detailed', '<p>{{name}}</p>{{#if phone}}<a href="tel:{{phone}}">{{phone}}</a>{{else if email}}<a href="mailto:{{email}}">{{email}}</a>{{else}}<span>Contact our office</span>{{/if}}');
		signature = await variation(signature, 'Compact', '{{#if phone}}{{#if name}}{{name}}: {{/if}}{{phone}}{{else}}No phone{{/if}}');
		signature = await contact(signature, { name: 'Phone <person>', phone: '+31 123', email: 'phone@example.test' });
		signature = await contact(signature, { name: 'Email person', email: 'email@example.test' });
		await fixture.pool.query('INSERT INTO signature_contacts(id, signature_id, fields) VALUES ($1, $2, $3)', [randomUUID(), signature.id, { name: 'Office person', phone: '', email: '' }]);
		signature = (await (await request(`/api/signatures/${signature.id}`)).json()).signature;
		const detailed = signature.variations.find((entry) => entry.name === 'Detailed')!;
		const compact = signature.variations.find((entry) => entry.name === 'Compact')!;
		const phoneContact = signature.contacts.find((entry) => entry.fields.name === 'Phone <person>')!;
		const emailContact = signature.contacts.find((entry) => entry.fields.name === 'Email person')!;
		const officeContact = signature.contacts.find((entry) => entry.fields.name === 'Office person')!;
		expect(await (await request(renderPath(signature, detailed.id, phoneContact.id))).text()).toBe('<p>Phone &lt;person&gt;</p><a href="tel:+31 123">+31 123</a>');
		expect(await (await request(renderPath(signature, detailed.id, emailContact.id))).text()).toBe('<p>Email person</p><a href="mailto:email@example.test">email@example.test</a>');
		expect(await (await request(renderPath(signature, detailed.id, officeContact.id))).text()).toBe('<p>Office person</p><span>Contact our office</span>');
		expect(await (await request(renderPath(signature, compact.id, phoneContact.id))).text()).toBe('Phone &lt;person&gt;: +31 123');
		expect(await (await request(renderPath(signature, compact.id, emailContact.id))).text()).toBe('No phone');
		const update = await request(`/api/signatures/${signature.id}/contacts/${phoneContact.id}`, 'PATCH', { revision: signature.revision, fields: { name: phoneContact.fields.name, phone: '', email: 'new@example.test' } });
		expect(update.status).toBe(200);
		signature = (await update.json()).signature;
		expect(await (await request(renderPath(signature, detailed.id, phoneContact.id))).text()).toBe('<p>Phone &lt;person&gt;</p><a href="mailto:new@example.test">new@example.test</a>');
		expect(await (await request(renderPath(signature, compact.id, phoneContact.id))).text()).toBe('No phone');
		expect((await request(`/signatures?signature=${signature.id}`)).status).toBe(200);
	});

	it('serializes simultaneous saves so only one writer with a shared revision succeeds', async () => {
		const signature = await create('Concurrent signature');
		const responses = await Promise.all([
			request(`/api/signatures/${signature.id}/contacts`, 'POST', { revision: signature.revision, fields: { name: 'First writer', email: 'first@example.test' } }),
			request(`/api/signatures/${signature.id}/contacts`, 'POST', { revision: signature.revision, fields: { name: 'Second writer', email: 'second@example.test' } })
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
		const saved = (await (await request(`/api/signatures/${signature.id}`)).json()).signature;
		expect(saved.contacts).toHaveLength(1);
		expect(saved.revision).toBe(2);
	});

	it('lets regular users delete contacts and variations but only administrators delete whole signatures, regardless of creator', async () => {
		let signature = await create('Delete this signature', outsiderCookie);
		signature = await variation(signature, 'One', '<p>{{name}}</p>');
		signature = await variation(signature, 'Two', '<p>{{name}}</p>');
		signature = await contact(signature, { name: 'Jane', email: 'jane@example.test' });
		signature = await contact(signature, { name: 'Alex', email: 'alex@example.test' });
		const keep = await create('Keep this signature');
		const projectResponse = await request('/api/projects', 'POST', { name: 'Unaffected newsletter' });
		expect(projectResponse.status).toBe(201);
		const project = (await projectResponse.json()).project;
		const deletedContact = signature.contacts[0].id;
		expect((await request(`/api/signatures/${signature.id}`, 'DELETE', { revision: signature.revision, confirmName: signature.name }, outsiderCookie)).status).toBe(403);
		const response = await request(`/api/signatures/${signature.id}/contacts/${deletedContact}`, 'DELETE', { revision: signature.revision }, outsiderCookie);
		expect(response.status).toBe(200);
		signature = (await response.json()).signature;
		expect(signature.contacts).toHaveLength(1);
		expect(signature.variations).toHaveLength(2);
		const deletedVariation = signature.variations[0].id;
		const remove = await request(`/api/signatures/${signature.id}/variations/${deletedVariation}`, 'DELETE', { revision: signature.revision }, outsiderCookie);
		expect(remove.status).toBe(200);
		signature = (await remove.json()).signature;
		expect(signature.variations).toHaveLength(1);
		expect(signature.contacts).toHaveLength(1);
		expect((await request(renderPath(signature, deletedVariation))).status).toBe(404);
		expect((await request(`/api/signatures/${signature.id}`, 'DELETE', { revision: signature.revision, confirmName: 'Wrong' })).status).toBe(400);
		expect((await request(`/api/signatures/${signature.id}`, 'DELETE', { revision: 1, confirmName: signature.name })).status).toBe(409);
		expect((await request(`/api/signatures/${signature.id}`, 'DELETE', { revision: signature.revision, confirmName: signature.name })).status).toBe(200);
		expect((await request(`/api/signatures/${signature.id}`)).status).toBe(404);
		expect((await fixture.pool.query('SELECT id FROM signature_variations WHERE signature_id = $1', [signature.id])).rows).toEqual([]);
		expect((await fixture.pool.query('SELECT id FROM signature_contacts WHERE signature_id = $1', [signature.id])).rows).toEqual([]);
		expect((await request(`/api/signatures/${keep.id}`)).status).toBe(200);
		const projects = (await (await request('/api/projects')).json()).projects;
		expect(projects.some((entry: { id: string }) => entry.id === project.id)).toBe(true);
	});

	it('preserves signatures, variations, and contacts when their creator account is deleted', async () => {
		let signature = await create('Deleted account signature', outsiderCookie);
		signature = await variation(signature, 'Private', '<p>{{name}}</p>', outsiderCookie);
		signature = await contact(signature, { name: 'Private contact', email: 'private@example.test' }, outsiderCookie);
		const user = (await fixture.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', ['outsider@example.test'])).rows[0];
		expect((await request(`/api/admin/users/${user.id}`, 'DELETE', {})).status).toBe(200);
		expect((await fixture.pool.query('SELECT created_by FROM email_signatures WHERE id = $1', [signature.id])).rows).toEqual([{ created_by: null }]);
		expect((await fixture.pool.query('SELECT id FROM signature_variations WHERE signature_id = $1', [signature.id])).rows).toHaveLength(1);
		expect((await fixture.pool.query('SELECT id FROM signature_contacts WHERE signature_id = $1', [signature.id])).rows).toHaveLength(1);
		expect((await request(`/api/signatures/${signature.id}`)).status).toBe(200);
		expect((await request(renderPath(signature))).status).toBe(200);
	});
});
