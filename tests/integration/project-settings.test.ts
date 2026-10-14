import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createNewsletter, createItem, type Newsletter } from '../../src/lib/newsletters';
import type { ImageAsset, RemoteProject } from '../../src/lib/remote';
import { version as appVersion } from '../../package.json';
import { startHostedFixture } from '../helpers/hosted-fixture';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let ownerCookie: string;
let memberCookie: string;
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

async function project(name = 'Project settings test', cookie = ownerCookie) {
	const response = await request('/api/projects', 'POST', { name }, cookie);
	expect(response.status).toBe(201);
	return (await response.json()).project as RemoteProject;
}

async function upload(id: string, newsletterId?: string) {
	const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer();
	const form = new FormData();
	form.set('image', new Blob([new Uint8Array(png).buffer], { type: 'image/png' }), 'project.png');
	const response = await fetch(`${fixture.origin}/api/projects/${id}/assets${newsletterId ? `?newsletterId=${newsletterId}` : ''}`, {
		method: 'POST', headers: { Cookie: ownerCookie, Origin: fixture.origin }, body: form
	});
	expect(response.status).toBe(201);
	return (await response.json()).asset as ImageAsset;
}

function deletion(value: RemoteProject) {
	return request(`/api/projects/${value.id}`, 'DELETE', { confirmName: value.name, revision: value.revision });
}

beforeAll(async () => {
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	memberCookie = await login('member@example.test');
	outsiderCookie = await login('outsider@example.test');
});
afterAll(async () => { if (fixture) await fixture.stop(); });

describe('project settings and deletion', () => {
	it('shows the current package version in the workspace footer', async () => {
		const response = await request('/');
		expect(response.status).toBe(200);
		const footer = (await response.text()).match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
		expect(footer?.replace(/<!--[\s\S]*?-->/g, '')).toBe(`Team Switch © 2026 · v${appVersion}`);
	});

	it('allows all signed-in users to rename independently of templates and recipients, validating revisions', async () => {
		const saved = await project();
		const path = `/api/projects/${saved.id}/settings`;
		expect((await request(path, 'PATCH', { name: 'Renamed', revision: 1 }, '')).status).toBe(401);
		expect((await request(path, 'PATCH', { name: 'Renamed', revision: 1 }, ownerCookie, 'https://wrong.test')).status).toBe(403);
		for (const body of [{}, { name: '', revision: 1 }, { name: 1, revision: 1 }, { name: 'x'.repeat(161), revision: 1 }, { name: 'Renamed', revision: 1, template: 'Must not save' }]) {
			expect((await request(path, 'PATCH', body)).status).toBe(400);
		}
		expect((await request(`/api/projects/${saved.id}/test-recipients`, 'PATCH', { recipients: 'shared@example.test', revision: 1 })).status).toBe(200);
		const response = await request(path, 'PATCH', { name: '  Renamed project  ', revision: 1 }, memberCookie);
		expect(response.status).toBe(200);
		expect((await response.json()).project).toEqual({ ...saved, name: 'Renamed project', revision: 2 });
		expect((await request(path, 'PATCH', { name: 'Stale', revision: 1 })).status).toBe(409);
		expect((await request(`/api/projects/${saved.id}`, 'PATCH', { ...saved, itemTemplate: saved.itemTemplate })).status).toBe(409);
		expect((await fixture.pool.query('SELECT name, template, item_template, revision FROM projects WHERE id = $1', [saved.id])).rows[0]).toEqual({
			name: 'Renamed project', template: saved.template, item_template: saved.itemTemplate, revision: 2
		});
		expect((await (await request(`/api/projects/${saved.id}/test-recipients`)).json()).settings).toEqual({ recipients: ['shared@example.test'], revision: 2 });
		expect((await request(path, 'PATCH', { name: 'Another user renamed this', revision: 2 }, outsiderCookie)).status).toBe(200);
	});

	it('requires an administrator, trusted origin, current revision, and exact saved name to delete even a regular user-created newsletter', async () => {
		const saved = await project('Exact Project Name', memberCookie);
		const path = `/api/projects/${saved.id}`;
		const body = { confirmName: saved.name, revision: 1 };
		expect((await request(path, 'DELETE', body, '')).status).toBe(401);
		expect((await request(path, 'DELETE', body, outsiderCookie)).status).toBe(403);
		expect((await request(path, 'DELETE', body, memberCookie)).status).toBe(403);
		expect((await request(path, 'DELETE', body, ownerCookie, 'https://wrong.test')).status).toBe(403);
		for (const invalid of [{ revision: 1 }, { ...body, confirmName: saved.name.toLowerCase() }, { ...body, confirmName: ` ${saved.name}` }, { ...body, confirmed: true }]) {
			expect((await request(path, 'DELETE', invalid)).status).toBe(400);
		}
		expect((await request(path, 'DELETE', { ...body, revision: 2 })).status).toBe(409);
		expect((await fixture.pool.query('SELECT deleted_at FROM projects WHERE id = $1', [saved.id])).rows[0].deleted_at).toBeNull();
		expect((await deletion(saved)).status).toBe(200);
	});

	it('removes all campaigns, clone/shared image files, access, and export links without affecting other projects or accounts', async () => {
		const saved = await project('Deleted project');
		const other = await project('Keep this project');
		const first = createNewsletter('First campaign');
		expect((await request(`/api/projects/${saved.id}/newsletters`, 'POST', { newsletter: first })).status).toBe(201);
		const shared = await upload(saved.id);
		const scoped = await upload(saved.id, first.id);
		const unrelated = await upload(other.id);
		first.items.push({ ...createItem(), fields: { title: 'Deleted story', image: scoped.url } });
		expect((await request(`/api/projects/${saved.id}/newsletters/${first.id}`, 'PATCH', { newsletter: first, revision: 1 })).status).toBe(200);
		const clone = createNewsletter('Cloned campaign');
		expect((await request(`/api/projects/${saved.id}/newsletters`, 'POST', { newsletter: clone, cloneSourceId: first.id })).status).toBe(201);
		const entries = (await (await request(`/api/projects/${saved.id}/newsletters`)).json()).newsletters as { newsletter: Newsletter; permalink: string }[];
		for (const entry of entries) expect((await fetch(entry.permalink)).status).toBe(200);
		const response = await deletion(saved);
		expect(response.status, fixture.appLogs.join('\n')).toBe(200);
		expect((await response.json()).deletedAssetIds.sort()).toEqual([shared.id, scoped.id].sort());
		for (const cookie of [ownerCookie, memberCookie]) {
			const list = (await (await request('/api/projects', 'GET', undefined, cookie)).json()).projects as RemoteProject[];
			expect(list.some((value) => value.id === saved.id)).toBe(false);
			for (const suffix of ['newsletters', 'assets', 'members', 'test-recipients', 'publications']) {
				expect((await request(`/api/projects/${saved.id}/${suffix}`, 'GET', undefined, cookie)).status).toBe(404);
			}
		}
		expect((await request(`/api/projects/${saved.id}/settings`, 'PATCH', { name: 'Revived', revision: 1 })).status).toBe(404);
		expect((await request(`/api/projects/${saved.id}/newsletters`, 'POST', { newsletter: createNewsletter('Revived') })).status).toBe(404);
		for (const entry of entries) expect((await fetch(entry.permalink)).status).toBe(404);
		for (const asset of [shared, scoped]) expect((await fetch(asset.url)).status).toBe(404);
		expect((await fetch(unrelated.url)).status).toBe(200);
		expect((await request(`/api/projects/${other.id}/newsletters`)).status).toBe(200);
		expect((await fixture.pool.query('SELECT id FROM "user"')).rowCount).toBe(3);
		expect((await deletion(saved)).status).toBe(200);
	});

	it('keeps a failed cleanup visible only to administrators and supports retry after a browser reload', async () => {
		const saved = await project('Retry cleanup');
		const asset = await upload(saved.id);
		const file = join(fixture.directory, 'uploads', `${asset.id}.webp`);
		const backup = `${file}.backup`;
		await rename(file, backup);
		await mkdir(file);
		try {
			const response = await deletion(saved);
			expect(response.status).toBe(500);
			expect(await response.text()).toContain('image cleanup failed');
			const ownerProjects = (await (await request('/api/projects')).json()).projects as RemoteProject[];
			expect(ownerProjects.find((value) => value.id === saved.id)?.deletionPending).toBe(true);
			const editorProjects = (await (await request('/api/projects', 'GET', undefined, memberCookie)).json()).projects as RemoteProject[];
			expect(editorProjects.some((value) => value.id === saved.id)).toBe(false);
			expect((await request(`/api/projects/${saved.id}/test-recipients`)).status).toBe(200);
			expect((await request(`/api/projects/${saved.id}/settings`, 'PATCH', { name: 'Cannot edit', revision: 1 })).status).toBe(404);
			expect((await request(`/api/projects/${saved.id}/test-recipients`, 'PATCH', { recipients: 'a@example.test', revision: 1 })).status).toBe(404);
		} finally {
			await rmdir(file);
			await rename(backup, file);
		}
		expect((await deletion(saved)).status).toBe(200);
		expect((await fetch(asset.url)).status).toBe(404);
		const list = (await (await request('/api/projects')).json()).projects as RemoteProject[];
		expect(list.some((value) => value.id === saved.id)).toBe(false);
	});

	it('rejects deletion atomically when an image is used by another project', async () => {
		const saved = await project('Referenced images');
		const other = await project('Image consumer');
		const asset = await upload(saved.id);
		const template = other.template.replace('<mj-body background-color="#f3f5ef">', `<mj-body background-color="#f3f5ef"><mj-section><mj-column><mj-image src="${asset.url}" /></mj-column></mj-section>`);
		expect((await request(`/api/projects/${other.id}`, 'PATCH', { ...other, template })).status).toBe(200);
		const response = await deletion(saved);
		expect(response.status).toBe(409);
		expect(await response.text()).toContain('another project');
		expect((await fixture.pool.query('SELECT deleted_at FROM projects WHERE id = $1', [saved.id])).rows[0].deleted_at).toBeNull();
		expect((await fetch(asset.url)).status).toBe(200);
		expect((await request(`/api/projects/${other.id}`, 'PATCH', { ...other, revision: 2 })).status).toBe(200);
		expect((await deletion(saved)).status).toBe(200);
	});

	it('rejects an edit that was queued before project deletion committed', async () => {
		const saved = await project('Queued edit');
		const blocker = await fixture.pool.connect();
		let pending: Promise<Response> | undefined;
		try {
			await blocker.query('BEGIN');
			await blocker.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [saved.id]);
			pending = request(`/api/projects/${saved.id}/settings`, 'PATCH', { name: 'Must not revive', revision: 1 });
			await vi.waitFor(async () => {
				const waiting = await fixture.pool.query(`SELECT pid FROM pg_stat_activity WHERE usename = 'postroom_app' AND wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%'`);
				expect(waiting.rowCount).toBe(1);
			}, { timeout: 5000 });
			await blocker.query('UPDATE projects SET deleted_at = now(), deletion_completed_at = now() WHERE id = $1', [saved.id]);
			await blocker.query('COMMIT');
		} finally {
			await blocker.query('ROLLBACK');
			blocker.release();
		}
		if (!pending) throw new Error('Expected a queued edit.');
		expect((await pending).status).toBe(404);
		expect((await fixture.pool.query('SELECT name FROM projects WHERE id = $1', [saved.id])).rows[0].name).toBe(saved.name);
	});
});
