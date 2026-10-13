import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createItem, createNewsletter, type Newsletter } from '../../src/lib/newsletters';
import type { ImageAsset, ProjectMember, RemoteProject } from '../../src/lib/remote';
import { requireProject } from '../../src/lib/server/workspace';
import { startHostedFixture } from '../helpers/hosted-fixture';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let ownerCookie: string;
let memberCookie: string;
let ownerId: string;

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

async function account(email: string, admin = false) {
	const { user } = await fixture.auth.api.signUpEmail({ body: { email, name: email.split('@')[0], password: fixture.password } });
	if (admin) await fixture.pool.query('INSERT INTO application_admins(user_id) VALUES ($1)', [user.id]);
	return { ...user, cookie: await login(email) };
}

async function project(cookie = ownerCookie) {
	const response = await request('/api/projects', 'POST', { name: 'Removal test' }, cookie);
	expect(response.status).toBe(201);
	return (await response.json()).project as RemoteProject;
}

async function share(projectId: string, email: string, cookie = ownerCookie) {
	expect((await request(`/api/projects/${projectId}/members`, 'POST', { email }, cookie)).status).toBe(200);
}

async function content(projectId: string, cookie: string) {
	const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer();
	const form = new FormData();
	form.set('image', new Blob([new Uint8Array(png).buffer], { type: 'image/png' }), 'retained.png');
	const uploaded = await fetch(`${fixture.origin}/api/projects/${projectId}/assets`, {
		method: 'POST', headers: { Cookie: cookie, Origin: fixture.origin }, body: form
	});
	expect(uploaded.status).toBe(201);
	const asset = (await uploaded.json()).asset as ImageAsset;
	const newsletter = createNewsletter('Retained campaign');
	newsletter.items.push({ ...createItem(), fields: {
		title: 'Retained story', text: 'Keep this content', image: asset.url, image_alt: 'Retained image',
		button: 'Read more', url: 'https://example.test/story'
	} });
	expect((await request(`/api/projects/${projectId}/newsletters`, 'POST', { newsletter }, cookie)).status).toBe(201);
	const entries = (await (await request(`/api/projects/${projectId}/newsletters`, 'GET', undefined, cookie)).json()).newsletters as { newsletter: Newsletter; permalink: string }[];
	const entry = entries.find((item) => item.newsletter.id === newsletter.id);
	if (!entry) throw new Error('Expected a saved newsletter and permalink.');
	const rendered = await fetch(entry.permalink);
	expect(rendered.status).toBe(200);
	return { asset, newsletter: entry.newsletter, permalink: entry.permalink, html: await rendered.text() };
}

beforeAll(async () => {
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	memberCookie = await login('member@example.test');
	ownerId = (await fixture.pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', ['owner@example.test'])).rows[0].id;
});
afterAll(async () => { if (fixture) await fixture.stop(); });
beforeEach(async () => { await fixture.pool.query('DELETE FROM "rateLimit"'); });

describe('user and project-member removal', () => {
	it('requires admin access and a trusted origin, rejects self-deletion, and reports missing accounts', async () => {
		const target = await account('protected@example.test');
		const path = `/api/admin/users/${target.id}`;
		expect((await request(path, 'DELETE', undefined, '')).status).toBe(401);
		expect((await request(path, 'DELETE', undefined, memberCookie)).status).toBe(403);
		expect((await request(path, 'DELETE', undefined, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		expect((await request(`/api/admin/users/${ownerId}`, 'DELETE')).status).toBe(400);
		expect((await request('/api/admin/users/nonexistent-account', 'DELETE')).status).toBe(404);
		expect((await fixture.pool.query('SELECT id FROM "user" WHERE id = $1', [target.id])).rowCount).toBe(1);
	});

	it('lets only owners remove editors, preserving their account, other access, campaigns, and public files', async () => {
		const editor = await account('removed-editor@example.test');
		const shared = await project();
		const other = await project(editor.cookie);
		await share(shared.id, editor.email);
		await share(shared.id, 'member@example.test');
		const saved = await content(shared.id, editor.cookie);
		const path = `/api/projects/${shared.id}/members/${editor.id}`;
		expect((await request(path, 'DELETE', undefined, '')).status).toBe(401);
		expect((await request(path, 'DELETE', undefined, memberCookie)).status).toBe(403);
		expect((await request(path, 'DELETE', undefined, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		expect((await request(`/api/projects/${other.id}/members/${editor.id}`, 'DELETE')).status).toBe(404);
		expect((await request(`/api/projects/${shared.id}/members/${ownerId}`, 'DELETE')).status).toBe(400);
		const removed = await request(path, 'DELETE');
		expect(removed.status).toBe(200);
		const members = (await removed.json()).members as ProjectMember[];
		expect(members.some((member) => member.id === editor.id)).toBe(false);
		expect(members.find((member) => member.id === ownerId)?.role).toBe('owner');
		expect((await request(path, 'DELETE')).status).toBe(404);
		expect((await request(`/api/projects/${shared.id}/newsletters`, 'GET', undefined, editor.cookie)).status).toBe(404);
		expect((await request(`/api/projects/${shared.id}`, 'PATCH', { ...shared, name: 'Unauthorized change' }, editor.cookie)).status).toBe(404);
		expect((await request(`/api/projects/${other.id}/members`, 'GET', undefined, editor.cookie)).status).toBe(200);
		expect(await login(editor.email)).toBeTruthy();
		expect(await (await fetch(saved.permalink)).text()).toBe(saved.html);
		expect((await fetch(saved.asset.url)).status).toBe(200);
		expect((await fixture.pool.query<{ created_by: string }>('SELECT created_by FROM newsletters WHERE id = $1', [saved.newsletter.id])).rows[0].created_by).toBe(editor.id);
	});

	it('rechecks project membership when a queued edit resumes after access removal', async () => {
		const editor = await account('queued-editor@example.test');
		const shared = await project();
		await share(shared.id, editor.email);
		const blocker = await fixture.pool.connect();
		let pending: Promise<Response> | undefined;
		try {
			await blocker.query('BEGIN');
			await blocker.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [shared.id]);
			pending = request(`/api/projects/${shared.id}`, 'PATCH', { ...shared, name: 'Must not be saved' }, editor.cookie);
			await vi.waitFor(async () => {
				const waiting = await fixture.pool.query(`SELECT pid FROM pg_stat_activity WHERE usename = 'postroom_app' AND wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%'`);
				expect(waiting.rowCount).toBe(1);
			}, { timeout: 5000 });
			await blocker.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [shared.id, editor.id]);
			await blocker.query('COMMIT');
		} finally {
			await blocker.query('ROLLBACK');
			blocker.release();
		}
		if (!pending) throw new Error('Expected a queued edit.');
		expect((await pending).status).toBe(404);
		expect((await fixture.pool.query('SELECT name, revision FROM projects WHERE id = $1', [shared.id])).rows[0]).toEqual({ name: shared.name, revision: shared.revision });
	});

	it('cleans up credentials, sessions, pending invitations, preferences, reset links, and admin access', async () => {
		const target = await account('pending-removal@example.test', true);
		await fixture.pool.query('INSERT INTO user_invitations(user_id) VALUES ($1)', [target.id]);
		expect((await request('/api/account/preferences', 'PATCH', { editorLayout: 'dynamic' }, target.cookie)).status).toBe(200);
		const token = randomUUID();
		const context = await fixture.auth.$context;
		await context.internalAdapter.createVerificationValue({ identifier: `reset-password:${token}`, value: target.id, expiresAt: new Date(Date.now() + 3600000) });
		const response = await request(`/api/admin/users/${target.id}`, 'DELETE');
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.transferredProjects).toBe(0);
		expect(result.users.some((user: { id: string }) => user.id === target.id)).toBe(false);
		for (const table of ['user', 'account', 'session', 'application_admins', 'user_invitations', 'user_preferences']) {
			const key = table === 'user' ? 'id' : table === 'account' || table === 'session' ? 'userId' : 'user_id';
			expect((await fixture.pool.query(`SELECT 1 FROM "${table}" WHERE "${key}" = $1`, [target.id])).rowCount, table).toBe(0);
		}
		expect((await fixture.pool.query('SELECT 1 FROM verification WHERE value = $1', [target.id])).rowCount).toBe(0);
		expect((await request('/api/projects', 'GET', undefined, target.cookie)).status).toBe(401);
		expect((await request('/api/auth/sign-in/email', 'POST', { email: target.email, password: fixture.password }, '')).status).toBe(401);
		expect((await request('/api/auth/reset-password', 'POST', { token, newPassword: fixture.password }, '')).status).toBe(400);
	});

	it('transfers every owned project, promotes an existing editor, and preserves authored immutable content under the restricted role', async () => {
		const target = await account('content-owner@example.test');
		const first = await project(target.cookie);
		const second = await project(target.cookie);
		const editorsOnly = await project();
		await share(second.id, 'owner@example.test', target.cookie);
		await share(editorsOnly.id, target.email);
		const saved = await content(first.id, target.cookie);
		const editorContent = await content(editorsOnly.id, target.cookie);
		const publicationId = randomUUID();
		await fixture.pool.query('INSERT INTO newsletter_publications(id, newsletter_id, project_id, content, mjml, html, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [publicationId, saved.newsletter.id, first.id, saved.newsletter, first.template, saved.html, target.id]);
		const response = await request(`/api/admin/users/${target.id}`, 'DELETE');
		expect(response.status, fixture.appLogs.join('\n')).toBe(200);
		expect((await response.json()).transferredProjects).toBe(2);
		for (const owned of [first, second]) {
			const members = (await (await request(`/api/projects/${owned.id}/members`)).json()).members as ProjectMember[];
			expect(members).toEqual([expect.objectContaining({ id: ownerId, role: 'owner' })]);
			expect((await fixture.pool.query('SELECT created_by FROM projects WHERE id = $1', [owned.id])).rows[0].created_by).toBeNull();
		}
		expect((await fixture.pool.query('SELECT user_id FROM project_members WHERE user_id = $1', [target.id])).rowCount).toBe(0);
		for (const retained of [saved, editorContent]) {
			const campaign = (await fixture.pool.query('SELECT content, revision, created_by FROM newsletters WHERE id = $1', [retained.newsletter.id])).rows[0];
			expect(campaign).toEqual({ content: retained.newsletter, revision: 1, created_by: null });
			const image = (await fixture.pool.query('SELECT created_by, bytes, original_name FROM image_assets WHERE id = $1', [retained.asset.id])).rows[0];
			expect(image).toEqual({ created_by: null, bytes: retained.asset.bytes, original_name: retained.asset.filename });
			expect((await fetch(retained.asset.url)).status).toBe(200);
			expect(await (await fetch(retained.permalink)).text()).toBe(retained.html);
		}
		expect((await fixture.pool.query('SELECT content, mjml, html, created_by FROM newsletter_publications WHERE id = $1', [publicationId])).rows[0]).toEqual({
			content: saved.newsletter, mjml: first.template, html: saved.html, created_by: null
		});
		expect((await request(`/api/projects/${first.id}`, 'PATCH', { ...first, name: 'Transferred project' })).status).toBe(200);
	});

	it('serializes account deletion with active author writes without deadlocks or lost content', async () => {
		const target = await account('active-author@example.test');
		const owned = await project(target.cookie);
		const writer = await fixture.pool.connect();
		let deletion: Promise<Response> | undefined;
		const newsletter = createNewsletter('Written before deletion');
		try {
			await writer.query('BEGIN');
			await requireProject(writer, owned.id, target.id, true);
			deletion = request(`/api/admin/users/${target.id}`, 'DELETE');
			await vi.waitFor(async () => {
				const waiting = await fixture.pool.query(`SELECT pid FROM pg_stat_activity WHERE usename = 'postroom_app' AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF u%'`);
				expect(waiting.rowCount).toBe(1);
			}, { timeout: 5000 });
			await writer.query('INSERT INTO newsletters(id, project_id, content, created_by) VALUES ($1,$2,$3,$4)', [newsletter.id, owned.id, newsletter, target.id]);
			await writer.query('COMMIT');
		} finally {
			await writer.query('ROLLBACK');
			writer.release();
		}
		if (!deletion) throw new Error('Expected a queued account deletion.');
		expect((await deletion).status, fixture.appLogs.join('\n')).toBe(200);
		expect((await fixture.pool.query('SELECT content, created_by FROM newsletters WHERE id = $1', [newsletter.id])).rows[0]).toEqual({ content: newsletter, created_by: null });
		expect((await request(`/api/projects/${owned.id}/members`)).status).toBe(200);
	});

	it('allows only one of two concurrent administrator deletions and leaves both projects with an owner', async () => {
		const first = await account('concurrent-first@example.test', true);
		const second = await account('concurrent-second@example.test', true);
		const firstProject = await project(first.cookie);
		const secondProject = await project(second.cookie);
		const responses = await Promise.all([
			request(`/api/admin/users/${second.id}`, 'DELETE', undefined, first.cookie),
			request(`/api/admin/users/${first.id}`, 'DELETE', undefined, second.cookie)
		]);
		expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
		expect(responses.filter((response) => response.status === 401 || response.status === 403)).toHaveLength(1);
		const surviving = await fixture.pool.query<{ user_id: string }>('SELECT user_id FROM application_admins WHERE user_id = ANY($1::text[])', [[first.id, second.id]]);
		expect(surviving.rowCount).toBe(1);
		for (const owned of [firstProject, secondProject]) {
			expect((await fixture.pool.query("SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'owner'", [owned.id])).rows).toEqual([{ user_id: surviving.rows[0].user_id }]);
		}
		expect((await fixture.pool.query('SELECT user_id FROM application_admins WHERE user_id = $1', [ownerId])).rowCount).toBe(1);
	});
});
