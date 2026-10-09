import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdir, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cloneNewsletter, composeNewsletter, createNewsletter, createItem, type Newsletter } from '../../src/lib/newsletters';
import { DEFAULT_TEMPLATE, MAX_IMAGE_BYTES, type ImageAsset, type ProjectMember, type RemoteProject } from '../../src/lib/remote';
import { DEFAULT_APPLICATION_SETTINGS, type ApplicationSettings } from '../../src/lib/application-settings';
import { EMPTY_UTM } from '../../src/lib/utm';
import { startHostedFixture } from '../helpers/hosted-fixture';

let fixture: Awaited<ReturnType<typeof startHostedFixture>>;
let ownerCookie = '';
let outsiderCookie = '';
let memberCookie = '';
let project: RemoteProject;
let outsiderProject: RemoteProject;
let asset: ImageAsset;
let newsletter: Newsletter;
let newsletterRevision = 0;
let exportUrl = '';
let exportedHtml = '';

async function request(path: string, method = 'GET', body?: unknown, cookie = ownerCookie, origin = fixture.origin) {
	return fetch(`${fixture.origin}${path}`, {
		method, redirect: 'manual',
		headers: { Accept: 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function permalink(projectId: string, newsletterId: string): Promise<string> {
	const response = await request(`/api/projects/${projectId}/newsletters`);
	expect(response.status).toBe(200);
	const entries = (await response.json()).newsletters as { newsletter: Newsletter; permalink: string }[];
	const entry = entries.find((entry) => entry.newsletter.id === newsletterId);
	if (!entry) throw new Error('Expected a saved edition with an HTML permalink.');
	return entry.permalink;
}

async function login(email: string) {
	const response = await request('/api/auth/sign-in/email', 'POST', { email, password: fixture.password }, '');
	expect(response.status).toBe(200);
	const cookies = response.headers.getSetCookie();
	expect(cookies.some((cookie) => cookie.toLowerCase().includes('httponly'))).toBe(true);
	return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function upload(data: Uint8Array<ArrayBuffer>, type: string, filename: string, projectId = project.id, newsletterId?: string, cookie = ownerCookie) {
	const form = new FormData();
	form.set('image', new Blob([data.buffer], { type }), filename);
	return fetch(`${fixture.origin}/api/projects/${projectId}/assets${newsletterId ? `?newsletterId=${newsletterId}` : ''}`, {
		method: 'POST', headers: { Cookie: cookie, Origin: fixture.origin }, body: form
	});
}

beforeAll(async () => {
	fixture = await startHostedFixture();
	ownerCookie = await login('owner@example.test');
	outsiderCookie = await login('outsider@example.test');
	memberCookie = await login('member@example.test');
});
afterAll(async () => { if (fixture) await fixture.stop(); });

describe('self-hosted workspace against PostgreSQL', () => {
	it('loads old editions without a lockout and allows replacing their legacy template', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Older content' });
		expect(created.status).toBe(201);
		const olderProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${olderProject.id}`;
		const old = {
			...createNewsletter('Old edition'),
			items: [
				{ id: 'old-item', title: 'Ignored old title', text: 'Ignored body', image: 'invalid-legacy-url' },
				{ id: 'mixed-item', title: 'Ignored old title', fields: { heading: 'Keep this typed heading' } }
			]
		};
		await fixture.pool.query('UPDATE projects SET item_template = $1 WHERE id = $2', ['<mj-section><mj-column><mj-text>{{title}}</mj-text></mj-column></mj-section>', olderProject.id]);
		await fixture.pool.query(`
			INSERT INTO newsletters(id, project_id, content, created_by)
			SELECT $1, $2, $3, created_by FROM projects WHERE id = $2`, [old.id, olderProject.id, old]);
		const loaded = await request(`${path}/newsletters`);
		expect(loaded.status).toBe(200);
		const canonical = (await loaded.json()).newsletters[0].newsletter as Newsletter;
		expect(canonical.items).toEqual([
			{ id: 'old-item', fields: {} },
			{ id: 'mixed-item', fields: { heading: 'Keep this typed heading' } }
		]);
		expect((await request('/')).status).toBe(200);
		const snippet = '<mj-section><mj-column><mj-text>{{text:heading}}</mj-text></mj-column></mj-section>';
		expect((await request(path, 'PATCH', { name: olderProject.name, template: olderProject.template, itemTemplate: snippet, revision: 1 })).status).toBe(200);
		expect((await request(`${path}/newsletters/${old.id}`, 'PATCH', { newsletter: old, revision: 1 })).status).toBe(200);
		const stored = (await fixture.pool.query<{ content: Newsletter }>('SELECT content FROM newsletters WHERE id = $1', [old.id])).rows[0].content;
		expect(stored.items).toEqual(canonical.items);
		const html = await fetch(await permalink(olderProject.id, old.id));
		expect(html.status).toBe(200);
		expect(await html.text()).toContain('Keep this typed heading');
	});

	it('persists editor layout per user across sign-ins and rejects invalid or cross-origin updates', async () => {
		const path = '/api/account/preferences';
		expect((await request(path, 'GET', undefined, '')).status).toBe(401);
		expect((await (await request(path)).json()).preferences).toEqual({ editorLayout: 'split' });
		expect((await request(path, 'PATCH', { editorLayout: 'dynamic' }, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		for (const body of [{}, { editorLayout: 'preview' }, { editorLayout: null }, { editorLayout: 'dynamic', userId: 'another-user' }]) {
			expect((await request(path, 'PATCH', body)).status).toBe(400);
		}
		const saved = await request(path, 'PATCH', { editorLayout: 'dynamic' });
		expect(saved.status).toBe(200);
		expect((await saved.json()).preferences).toEqual({ editorLayout: 'dynamic' });
		expect((await (await request(path, 'GET', undefined, outsiderCookie)).json()).preferences).toEqual({ editorLayout: 'split' });
		const newSession = await login('owner@example.test');
		expect((await (await request(path, 'GET', undefined, newSession)).json()).preferences).toEqual({ editorLayout: 'dynamic' });
		const workspace = await request('/');
		expect(workspace.status).toBe(200);
		const html = await workspace.text();
		expect(html).toContain('Your account');
		expect(html).not.toContain('workspace-card');
		expect((await request(path, 'PATCH', { editorLayout: 'split' })).status).toBe(200);
	});

	it('persists independent edition UTM settings and updates public HTML without changing original URLs', async () => {
		const main = '<mjml><mj-body><mj-section><mj-column><mj-button href="https://example.test/literal?existing=1&amp;utm_source=old#part">Literal link</mj-button><mj-text><a href="mailto:test@example.test">Email</a><a href="#anchor">Anchor</a></mj-text></mj-column></mj-section>{{items}}</mj-body></mjml>';
		const snippet = '<mj-section><mj-column><mj-button href="{{url:landing}}">{{text:heading}}</mj-button><mj-image src="{{image:photo}}" /></mj-column></mj-section>';
		const created = await request('/api/projects', 'POST', { name: 'UTM links', template: main, itemTemplate: snippet });
		expect(created.status).toBe(201);
		const trackingProject = (await created.json()).project as RemoteProject;
		expect(trackingProject).not.toHaveProperty('utm');
		const path = `/api/projects/${trackingProject.id}`;
		const utm = { utm_source: 'mail', utm_medium: 'mail', utm_campaign: 'nieuwsbrief & bloemen', utm_term: 'october_26' };
		const edition = createNewsletter('Tracked newsletter');
		expect(edition.utm).toEqual(EMPTY_UTM);
		edition.items.push({ ...createItem(), fields: { landing: 'https://example.test/typed?existing=2#story', heading: 'Typed link', photo: 'https://example.test/image.png' } });
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: edition })).status).toBe(201);
		edition.utm = utm;
		const editionPath = `${path}/newsletters/${edition.id}`;
		const body = { newsletter: edition, revision: 1 };
		expect((await request(editionPath, 'PATCH', body, outsiderCookie)).status).toBe(404);
		for (const invalid of [null, { utm_source: 1 }, { utm_campaign: 'x'.repeat(201) }]) {
			expect((await request(editionPath, 'PATCH', { ...body, newsletter: { ...edition, utm: invalid } })).status).toBe(400);
		}
		const updated = await request(editionPath, 'PATCH', body);
		expect(updated.status).toBe(200);
		expect((await updated.json()).newsletter.utm).toEqual(utm);
		expect((await request(editionPath, 'PATCH', body)).status).toBe(409);
		const source = composeNewsletter(main, snippet, edition).source;
		const preview = await request('/api/render', 'POST', { source, utm });
		expect(preview.status).toBe(200);
		const previewHtml = (await preview.json()).html as string;
		const query = 'utm_source=mail&amp;utm_medium=mail&amp;utm_campaign=nieuwsbrief+%26+bloemen&amp;utm_term=october_26';
		expect(previewHtml).toContain(`href="https://example.test/literal?existing=1&amp;${query}#part"`);
		expect(previewHtml).toContain(`href="https://example.test/typed?existing=2&amp;${query}#story"`);
		expect(previewHtml).toContain('src="https://example.test/image.png"');
		expect(previewHtml).toContain('href="mailto:test@example.test"');
		expect(previewHtml).toContain('href="#anchor"');
		expect((await request('/api/render', 'POST', { source, utm: { utm_term: 1 } })).status).toBe(400);
		const htmlPath = await permalink(trackingProject.id, edition.id);
		const html = await (await fetch(htmlPath)).text();
		expect(html).toContain(`href="https://example.test/typed?existing=2&amp;${query}#story"`);
		expect(html).toContain(`href="https://example.test/literal?existing=1&amp;${query}#part"`);
		const stored = (await (await request(`${path}/newsletters`)).json()).newsletters[0].newsletter as Newsletter;
		expect(stored.items[0].fields).toEqual(edition.items[0].fields);
		expect(stored.utm).toEqual(utm);
		const clone = cloneNewsletter(stored, 'Independent tracking');
		clone.utm.utm_term = 'november_26';
		expect(stored.utm.utm_term).toBe('october_26');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: clone })).status).toBe(201);
		const cloneUrl = await permalink(trackingProject.id, clone.id);
		expect(cloneUrl).not.toBe(htmlPath);
		expect(await (await fetch(cloneUrl)).text()).toContain('utm_term=november_26');
		expect((await request(editionPath, 'PATCH', { newsletter: { ...edition, utm: EMPTY_UTM }, revision: 2 })).status).toBe(200);
		expect(await permalink(trackingProject.id, edition.id)).toBe(htmlPath);
		expect(await (await fetch(htmlPath)).text()).not.toContain('utm_medium=mail');
		expect(await (await fetch(cloneUrl)).text()).toContain('utm_term=november_26');
		expect((await (await request('/api/render', 'POST', { source, utm: EMPTY_UTM })).json()).html).not.toContain('utm_medium');
	});

	it('deletes editions with revision checks, expires permalinks, preserves clone images, and retries orphan-file cleanup', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Edition deletion' });
		const deletionProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${deletionProject.id}`;
		const first = createNewsletter('Delete this edition');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: first })).status).toBe(201);
		const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer();
		async function image(name: string, editionId?: string) {
			const response = await upload(new Uint8Array(png), 'image/png', name, deletionProject.id, editionId);
			expect(response.status).toBe(201);
			return (await response.json()).asset as ImageAsset;
		}
		const projectImage = await image('project.png');
		const publishedImage = await image('exported.png', first.id);
		const sharedImage = await image('clone-library.png', first.id);
		first.items.push({ ...createItem(), fields: { title: 'Current export', image: publishedImage.url } });
		expect((await request(`${path}/newsletters/${first.id}`, 'PATCH', { newsletter: first, revision: 1 })).status).toBe(200);
		const htmlUrl = await permalink(deletionProject.id, first.id);
		expect((await fetch(htmlUrl)).status).toBe(200);
		const clone = createNewsletter('Surviving clone');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: clone, cloneSourceId: first.id })).status).toBe(201);
		const unusedImage = await image('unused.png', first.id);
		const editionPath = `${path}/newsletters/${first.id}`;
		expect((await request(editionPath, 'DELETE', { revision: 2 }, '')).status).toBe(401);
		expect((await request(editionPath, 'DELETE', { revision: 2 }, outsiderCookie)).status).toBe(404);
		expect((await request(editionPath, 'DELETE', { revision: 2 }, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		expect((await request(editionPath, 'DELETE', { revision: 1 })).status).toBe(409);
		expect((await request(editionPath, 'DELETE', {})).status).toBe(400);
		const file = join(fixture.directory, 'uploads', `${unusedImage.id}.webp`);
		const backup = `${file}.backup`;
		await rename(file, backup);
		await mkdir(file);
		try {
			const failed = await request(editionPath, 'DELETE', { revision: 2 });
			expect(failed.status).toBe(500);
			expect(await failed.text()).toContain('image cleanup failed');
		} finally {
			await rmdir(file);
			await rename(backup, file);
		}
		const retried = await request(editionPath, 'DELETE', { revision: 2 });
		expect(retried.status).toBe(200);
		expect((await retried.json()).deletedAssetIds).toEqual([unusedImage.id]);
		expect((await fetch(unusedImage.url)).status).toBe(404);
		expect((await fetch(projectImage.url)).status).toBe(200);
		expect((await fetch(publishedImage.url)).status).toBe(200);
		expect((await fetch(sharedImage.url)).status).toBe(200);
		expect((await (await request(`${path}/newsletters`)).json()).newsletters.map((entry: { newsletter: Newsletter }) => entry.newsletter.id)).toEqual([clone.id]);
		expect((await request(editionPath, 'PATCH', { newsletter: first, revision: 2 })).status).toBe(404);
		expect((await fetch(htmlUrl)).status).toBe(404);
		expect((await request(`${path}/assets?newsletterId=${first.id}`)).status).toBe(404);
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: createNewsletter('Invalid clone'), cloneSourceId: first.id })).status).toBe(404);
		const clonedAssets = (await (await request(`${path}/assets?newsletterId=${clone.id}`)).json()).assets as ImageAsset[];
		expect(clonedAssets.map((asset) => asset.id)).toEqual(expect.arrayContaining([publishedImage.id, sharedImage.id, projectImage.id]));
		expect((await request(`${path}/newsletters/${clone.id}`, 'DELETE', { revision: 1 })).status).toBe(200);
		expect((await fetch(sharedImage.url)).status).toBe(404);
		expect((await fetch(publishedImage.url)).status).toBe(404);
		expect((await request(`${path}/assets/${publishedImage.id}?newsletterId=${first.id}`, 'DELETE')).status).toBe(404);
		expect((await fetch(htmlUrl)).status).toBe(404);
	});

	it('restricts application branding to explicit administrators and persists it across workspace and sign-in pages', async () => {
		const path = '/api/admin/settings';
		expect((await request(path, 'GET', undefined, '')).status).toBe(401);
		expect((await request('/admin', 'GET', undefined, '')).status).toBe(303);
		expect((await request('/admin', 'GET', undefined, outsiderCookie)).status).toBe(403);
		expect((await request(path, 'GET', undefined, outsiderCookie)).status).toBe(403);
		const initial = (await (await request(path)).json()).settings as ApplicationSettings;
		expect(initial).toEqual(DEFAULT_APPLICATION_SETTINGS);
		const settings = { applicationName: 'Switch Newsletter Studio', baseColor: '#2457AB', accentColor: '#AA2244', revision: initial.revision };
		expect((await request(path, 'PATCH', settings, outsiderCookie)).status).toBe(403);
		expect((await request(path, 'PATCH', settings, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		for (const invalid of [{ applicationName: ' ' }, { applicationName: 'A'.repeat(81) }, { baseColor: '#000000;background:red' }, { accentColor: '#000000;background:red' }, { baseColor: undefined }, { accentColor: undefined }]) {
			expect((await request(path, 'PATCH', { ...settings, ...invalid })).status).toBe(400);
		}
		const changed = await request(path, 'PATCH', settings);
		expect(changed.status).toBe(200);
		expect((await changed.json()).settings).toEqual({ ...settings, baseColor: '#2457ab', accentColor: '#aa2244', revision: 2 });
		expect((await request(path, 'PATCH', settings)).status).toBe(409);
		expect((await (await request(path)).json()).settings.applicationName).toBe(settings.applicationName);
		const adminWorkspace = await (await request('/')).text();
		expect(adminWorkspace).toContain('Admin settings');
		expect(adminWorkspace).toContain(settings.applicationName);
		expect(adminWorkspace).toContain('--ui-primary:#aa2244');
		expect(adminWorkspace).toContain('--ui-accent:#aa2244');
		expect(adminWorkspace).toContain('color-mix(in srgb, #2457ab');
		const ordinaryWorkspace = await (await request('/', 'GET', undefined, outsiderCookie)).text();
		expect(ordinaryWorkspace).toContain(settings.applicationName);
		expect(ordinaryWorkspace).not.toContain('href="/admin"');
		const signIn = await (await request('/login', 'GET', undefined, '')).text();
		expect(signIn).toContain(`Sign in — ${settings.applicationName}`);
		expect(signIn).toContain('--ui-primary:#aa2244');
		const privileges = await fixture.pool.query<{ can_grant_admin: boolean; can_delete_settings: boolean }>(
			"SELECT has_table_privilege('postroom_app', 'application_admins', 'INSERT') AS can_grant_admin, has_table_privilege('postroom_app', 'application_settings', 'DELETE') AS can_delete_settings"
		);
		expect(privileges.rows[0]).toEqual({ can_grant_admin: true, can_delete_settings: false });
		await fixture.pool.query('DELETE FROM application_admins WHERE user_id = (SELECT id FROM "user" WHERE email = $1)', ['owner@example.test']);
		expect((await request(path)).status).toBe(403);
		expect((await request(path, 'PATCH', { ...DEFAULT_APPLICATION_SETTINGS, revision: 2 })).status).toBe(403);
		await fixture.pool.query('INSERT INTO application_admins(user_id) SELECT id FROM "user" WHERE email = $1', ['owner@example.test']);
		expect((await request(path, 'PATCH', { ...DEFAULT_APPLICATION_SETTINGS, revision: 2 })).status).toBe(200);
	});

	it('persists typed fields at both scopes, validates updates, and exports their rendered values', async () => {
		const main = '<mjml><mj-body><mj-section><mj-column><mj-text>{{text:heading}}</mj-text><mj-image src="{{ image:hero }}" /></mj-column></mj-section>{{items}}</mj-body></mjml>';
		const snippet = '<mj-section><mj-column><mj-text>{{text:heading}} {{textarea:description}} {{number:price}}</mj-text><mj-image src="{{ image:photo }}" /></mj-column></mj-section>';
		const created = await request('/api/projects', 'POST', { name: 'Typed fields', template: main, itemTemplate: snippet });
		expect(created.status).toBe(201);
		const typedProject = (await created.json()).project as RemoteProject;
		const png = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#426838' } }).png().toBuffer();
		const uploaded = await upload(new Uint8Array(png), 'image/png', 'typed-photo.png', typedProject.id);
		expect(uploaded.status).toBe(201);
		const uploadedAsset = (await uploaded.json()).asset as ImageAsset;
		const library = await request(`/api/projects/${typedProject.id}/assets`);
		expect((await library.json()).assets[0].url).toBe(uploadedAsset.url);
		const typedNewsletter = createNewsletter('Typed edition');
		typedNewsletter.fields = { heading: 'Global heading', hero: uploadedAsset.url };
		typedNewsletter.items.push({
			...createItem(), fields: {
				heading: 'Story heading', description: 'First line\nSecond line', price: '12.5', photo: uploadedAsset.url
			}
		});
		const path = `/api/projects/${typedProject.id}/newsletters`;
		const saved = await request(path, 'POST', { newsletter: typedNewsletter });
		expect(saved.status).toBe(201);
		const entry = await saved.json();
		expect(entry.newsletter.fields).toEqual(typedNewsletter.fields);
		expect(entry.newsletter.items[0].fields).toEqual(typedNewsletter.items[0].fields);
		const listed = await request(path);
		expect((await listed.json()).newsletters[0].newsletter).toEqual(entry.newsletter);
		const invalid = { ...entry.newsletter, items: [{ ...entry.newsletter.items[0], fields: { price: 'Infinity' } }] };
		expect((await request(`${path}/${typedNewsletter.id}`, 'PATCH', { newsletter: invalid, revision: 1 })).status).toBe(400);
		const invalidUrl = { ...entry.newsletter, items: [{ ...entry.newsletter.items[0], fields: { photo: 'javascript:alert(1)' } }] };
		expect((await request(path, 'POST', { newsletter: { ...invalidUrl, id: crypto.randomUUID() } })).status).toBe(400);
		const updated = await request(`${path}/${typedNewsletter.id}`, 'PATCH', { newsletter: entry.newsletter, revision: 1 });
		expect(updated.status).toBe(200);
		expect((await updated.json()).newsletter.items[0].fields).toEqual(typedNewsletter.items[0].fields);
		const originalUrl = await permalink(typedProject.id, typedNewsletter.id);
		const exported = await fetch(originalUrl);
		const html = await exported.text();
		expect(html).toContain('Global heading');
		expect(html).toContain('Story heading');
		expect(html).toContain('First line<br');
		expect(html).toContain('12.5');
		expect(html).toContain(uploadedAsset.url);
		expect((await fetch(uploadedAsset.url)).status).toBe(200);
		const clone = cloneNewsletter(entry.newsletter, 'Typed edition variation');
		const cloned = await request(path, 'POST', { newsletter: clone });
		expect(cloned.status).toBe(201);
		const clonedEntry = await cloned.json();
		expect(clonedEntry.revision).toBe(1);
		expect(clonedEntry.newsletter.id).not.toBe(typedNewsletter.id);
		expect(clonedEntry.newsletter.fields).toEqual(typedNewsletter.fields);
		expect(clonedEntry.newsletter.items[0].id).not.toBe(typedNewsletter.items[0].id);
		expect(clonedEntry.newsletter.items[0].fields).toEqual(typedNewsletter.items[0].fields);
		expect(clonedEntry.permalink).not.toBe(originalUrl);
		expect(await (await fetch(clonedEntry.permalink)).text()).toContain('Global heading');
		expect((await request(`/api/projects/${typedProject.id}/publications`, 'POST', { newsletterId: clone.id, revision: 1 })).status).toBe(405);
		const rejected = await request(`/api/projects/${typedProject.id}`, 'PATCH', { name: 'Typed fields', template: main, itemTemplate: '{{text:heading}}{{number:heading}}', revision: 1 });
		expect(rejected.status).toBe(400);
	});

	it('requires authentication, disables public registration, and exposes no local workspace', async () => {
		expect((await request('/api/projects', 'GET', undefined, '')).status).toBe(401);
		const home = await request('/', 'GET', undefined, '');
		expect(home.status).toBe(303);
		expect(home.headers.get('location')).toBe('/login');
		expect((await request('/local')).status).toBe(404);
		expect((await request('/api/auth/sign-up/email', 'POST', { email: 'public@example.test', name: 'Public', password: fixture.password }, '')).status).toBe(403);
		const wrong = await request('/api/auth/sign-in/email', 'POST', { email: 'owner@example.test', password: 'incorrect-test-password' }, '');
		expect(wrong.status).toBe(401);
	});

	it('creates projects and restricts them to their members', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Studio project' });
		expect(created.status).toBe(201);
		project = (await created.json()).project;
		const outsiderCreated = await request('/api/projects', 'POST', { name: 'Other project' }, outsiderCookie);
		outsiderProject = (await outsiderCreated.json()).project;
		expect(outsiderProject.role).toBe('owner');
		expect((await request('/api/admin/settings', 'GET', undefined, outsiderCookie)).status).toBe(403);
		const list = await request('/api/projects', 'GET', undefined, outsiderCookie);
		expect((await list.json()).projects.map((project: RemoteProject) => project.id)).toEqual([outsiderProject.id]);
		expect((await request(`/api/projects/${project.id}/assets`, 'GET', undefined, outsiderCookie)).status).toBe(404);
		expect((await request(`/api/projects/${project.id}/newsletters`, 'GET', undefined, outsiderCookie)).status).toBe(404);
	});

	it('shares projects with provisioned users without granting ownership', async () => {
		const shared = await request(`/api/projects/${project.id}/members`, 'POST', { email: 'member@example.test' });
		expect(shared.status).toBe(200);
		const list = await request('/api/projects', 'GET', undefined, memberCookie);
		expect((await list.json()).projects[0].role).toBe('editor');
		expect((await request(`/api/projects/${project.id}/members`, 'POST', { email: 'owner@example.test' }, memberCookie)).status).toBe(200);
		const ownerProjects = (await (await request('/api/projects')).json()).projects as RemoteProject[];
		expect(ownerProjects.find((entry) => entry.id === project.id)?.role).toBe('owner');
	});

	it('lists only project members for owners and editors and refreshes the list when sharing', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Access list' });
		expect(created.status).toBe(201);
		const accessProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${accessProject.id}/members`;
		expect((await request(path, 'GET', undefined, '')).status).toBe(401);
		expect((await request(path, 'GET', undefined, memberCookie)).status).toBe(404);
		expect((await request(path, 'GET', undefined, outsiderCookie)).status).toBe(404);
		expect((await request(`/api/projects/${outsiderProject.id}/members`)).status).toBe(404);
		const initial = await request(path);
		expect(initial.status).toBe(200);
		const owner = { id: expect.any(String), name: 'owner', email: 'owner@example.test', role: 'owner' };
		expect((await initial.json()).members).toEqual([owner]);
		const shared = await request(path, 'POST', { email: 'member@example.test' });
		expect(shared.status).toBe(200);
		const expected = [owner, { id: expect.any(String), name: 'member', email: 'member@example.test', role: 'editor' }];
		const members = (await shared.json()).members as ProjectMember[];
		expect(members).toEqual(expected);
		expect(new Set(members.map((member) => member.id)).size).toBe(2);
		for (const cookie of [ownerCookie, memberCookie]) {
			const response = await request(path, 'GET', undefined, cookie);
			expect(response.status).toBe(200);
			expect((await response.json()).members).toEqual(expected);
		}
		const duplicate = await request(path, 'POST', { email: 'owner@example.test' }, memberCookie);
		expect(duplicate.status).toBe(200);
		expect((await duplicate.json()).members).toEqual(expected);
		const extended = await request(path, 'POST', { email: 'outsider@example.test' }, memberCookie);
		expect(extended.status).toBe(200);
		const allMembers = [...expected, { id: expect.any(String), name: 'outsider', email: 'outsider@example.test', role: 'editor' }];
		expect((await extended.json()).members).toEqual(allMembers);
		expect((await (await request(path, 'GET', undefined, outsiderCookie)).json()).members).toEqual(allMembers);
	});

	it('lets editors share projects and newly added editors share them again, but blocks non-members', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Member sharing' });
		expect(created.status).toBe(201);
		const sharingProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${sharingProject.id}/members`;
		const body = { email: 'outsider@example.test' };
		expect((await request(path, 'POST', body, '')).status).toBe(401);
		expect((await request(path, 'POST', body, memberCookie)).status).toBe(404);
		expect((await request(path, 'POST', { email: 'member@example.test' })).status).toBe(200);
		expect((await request(path, 'POST', body, memberCookie, 'https://untrusted.example')).status).toBe(403);
		expect((await request(path, 'POST', { email: 42 }, memberCookie)).status).toBe(400);
		expect((await request(path, 'POST', { email: 'not-provisioned@example.test' }, memberCookie)).status).toBe(404);
		expect((await request(path, 'POST', { email: '  OUTSIDER@example.test  ' }, memberCookie)).status).toBe(200);
		expect((await request(path, 'POST', body, memberCookie)).status).toBe(200);
		const outsiderProjects = (await (await request('/api/projects', 'GET', undefined, outsiderCookie)).json()).projects as RemoteProject[];
		expect(outsiderProjects.filter((entry) => entry.id === sharingProject.id)).toEqual([{ ...sharingProject, role: 'editor' }]);
		expect((await request(`/api/projects/${sharingProject.id}/newsletters`, 'GET', undefined, outsiderCookie)).status).toBe(200);
		expect((await request(path, 'POST', { email: 'member@example.test' }, outsiderCookie)).status).toBe(200);
		expect((await request(`/api/projects/${outsiderProject.id}/members`, 'POST', { email: 'member@example.test' })).status).toBe(404);
	});

	it('saves templates with optimistic concurrency protection', async () => {
		const template = DEFAULT_TEMPLATE.replace('<mj-body background-color="#f3f5ef">', '<mj-body background-color="#f3f5ef"><mj-section><mj-column><mj-text>Stable header</mj-text></mj-column></mj-section>');
		const body = { name: project.name, template, itemTemplate: null, revision: project.revision };
		const updated = await request(`/api/projects/${project.id}`, 'PATCH', body);
		expect(updated.status).toBe(200);
		project = (await updated.json()).project;
		expect((await request(`/api/projects/${project.id}`, 'PATCH', body)).status).toBe(409);
	});

	it('uploads a real image and serves an immutable public WebP without authentication', async () => {
		const png = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#426838' } }).png().toBuffer();
		const response = await upload(new Uint8Array(png), 'image/png', 'story.png');
		expect(response.status).toBe(201);
		asset = (await response.json()).asset;
		const image = await fetch(asset.url);
		expect(image.status).toBe(200);
		expect(image.headers.get('content-type')).toBe('image/webp');
		expect(image.headers.get('cache-control')).toContain('immutable');
		const metadata = await sharp(await image.arrayBuffer()).metadata();
		expect(metadata.width).toBe(16);
		expect(metadata.height).toBe(24);
	});

	it('rejects unsupported and oversized images explicitly', async () => {
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
		expect((await upload(svg, 'image/svg+xml', 'unsafe.svg')).status).toBe(400);
		expect((await upload(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png', 'oversized.png')).status).toBe(400);
	});

	it('saves a newsletter and binds hosted images to the correct project', async () => {
		newsletter = createNewsletter('October edition');
		newsletter.items.push({
			...createItem(), fields: { title: 'Original story', text: 'Unique newsletter content',
				image: asset.url, image_alt: 'Our story image',
				button: 'Read more', url: 'https://example.com/story' }
		});
		const response = await request(`/api/projects/${project.id}/newsletters`, 'POST', { newsletter });
		expect(response.status).toBe(201);
		const saved = await response.json();
		newsletter = saved.newsletter;
		newsletterRevision = saved.revision;
		expect(newsletter.items[0].fields.image).toBe(asset.url);
		const list = await request(`/api/projects/${project.id}/newsletters`);
		expect((await list.json()).newsletters[0].newsletter).toEqual(newsletter);
		expect((await request(`/api/projects/${project.id}/newsletters`, 'POST', { newsletter })).status).toBe(409);
		const crossProject = await request(`/api/projects/${outsiderProject.id}/newsletters`, 'POST', { newsletter: { ...newsletter, id: crypto.randomUUID() } }, outsiderCookie);
		expect(crossProject.status).toBe(400);
	});

	it('rejects stale newsletter saves without changing the latest content', async () => {
		const body = { newsletter: { ...newsletter, name: 'October revised' }, revision: newsletterRevision };
		const response = await request(`/api/projects/${project.id}/newsletters/${newsletter.id}`, 'PATCH', body);
		expect(response.status).toBe(200);
		const saved = await response.json();
		newsletter = saved.newsletter;
		newsletterRevision = saved.revision;
		expect((await request(`/api/projects/${project.id}/newsletters/${newsletter.id}`, 'PATCH', body)).status).toBe(409);
	});

	it('serves an unlisted public HTML permalink without authentication or stale caching', async () => {
		exportUrl = await permalink(project.id, newsletter.id);
		expect(exportUrl).toMatch(/\/newsletters\/[a-f0-9-]{36}\.html$/);
		expect(exportUrl).not.toContain(newsletter.id);
		const exported = await fetch(exportUrl, { headers: { 'User-Agent': 'Mailchimp HTML importer' } });
		expect(exported.status).toBe(200);
		expect(exported.headers.get('content-type')).toContain('text/html');
		expect(exported.headers.get('cache-control')).toContain('no-store');
		expect(exported.headers.get('cache-control')).toContain('max-age=0');
		expect(exported.headers.get('referrer-policy')).toBe('no-referrer');
		expect(exported.headers.get('x-robots-tag')).toContain('noindex');
		expect(exported.headers.get('content-security-policy')).toContain('sandbox');
		exportedHtml = await exported.text();
		expect(exportedHtml).toContain('Original story');
		expect(exportedHtml).toContain('Stable header');
		expect(exportedHtml).toContain(asset.url);
		expect((await fetch(`${fixture.origin}/newsletters/${newsletter.id}.html`)).status).toBe(404);
		expect((await fetch(`${fixture.origin}/newsletters/not-an-export.html`)).status).toBe(404);
		const head = await fetch(exportUrl, { method: 'HEAD' });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe('');
	});

	it('keeps the same permalink while updating saved content and project templates', async () => {
		const edited = { ...newsletter, items: newsletter.items.map((item) => ({ ...item, fields: { ...item.fields, title: 'A later story' } })) };
		expect((await request(`/api/projects/${project.id}/newsletters/${newsletter.id}`, 'PATCH', { newsletter: edited, revision: newsletterRevision })).status).toBe(200);
		expect((await request(`/api/projects/${project.id}`, 'PATCH', { name: project.name, template: project.template.replace('Stable header', 'Changed header'), itemTemplate: null, revision: project.revision })).status).toBe(200);
		expect(await permalink(project.id, newsletter.id)).toBe(exportUrl);
		const exported = await fetch(exportUrl, { headers: { 'If-Modified-Since': new Date().toUTCString(), 'If-None-Match': '"stale-version"' } });
		expect(exported.status).toBe(200);
		const latest = await exported.text();
		expect(latest).not.toBe(exportedHtml);
		expect(latest).toContain('A later story');
		expect(latest).toContain('Changed header');
		expect(latest).not.toContain('Original story');
		expect((await fetch(asset.url)).status).toBe(200);
	});

	it('protects mutations from foreign origins and requires authentication for rendering', async () => {
		expect((await request('/api/projects', 'POST', { name: 'Cross-site attempt' }, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		expect((await request('/api/render', 'POST', { source: '<mjml />' }, '')).status).toBe(401);
		const rendered = await request('/api/render', 'POST', { source: '<mjml><mj-body><mj-section><mj-column><mj-text>Authenticated preview</mj-text></mj-column></mj-section></mj-body></mjml>' });
		expect(rendered.status).toBe(200);
		expect((await rendered.json()).html).toContain('Authenticated preview');
	});

	it('reports invalid saved templates instead of stale HTML and recovers at the same permalink', async () => {
		const template = '<mjml><mj-body><mj-section><mj-column><mj-text>Valid saved HTML</mj-text></mj-column></mj-section>{{items}}</mj-body></mjml>';
		const created = await request('/api/projects', 'POST', { name: 'HTML export errors', template });
		expect(created.status).toBe(201);
		let exportProject = (await created.json()).project as RemoteProject;
		const edition = createNewsletter('Export recovery');
		const path = `/api/projects/${exportProject.id}`;
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: edition })).status).toBe(201);
		const htmlUrl = await permalink(exportProject.id, edition.id);
		expect(await (await fetch(htmlUrl)).text()).toContain('Valid saved HTML');
		for (const invalid of [
			template.replace('{{items}}', ''),
			template.replace('<mj-text>', '<mj-unknown>').replace('</mj-text>', '</mj-unknown>')
		]) {
			const updated = await request(path, 'PATCH', { name: exportProject.name, template: invalid, itemTemplate: null, revision: exportProject.revision });
			expect(updated.status).toBe(200);
			exportProject = (await updated.json()).project;
			const response = await fetch(htmlUrl);
			expect(response.status).toBe(422);
			expect((await response.json()).message).toMatch(/exported|MJML validation/);
		}
		expect((await request(path, 'PATCH', { name: exportProject.name, template, itemTemplate: null, revision: exportProject.revision })).status).toBe(200);
		expect(await permalink(exportProject.id, edition.id)).toBe(htmlUrl);
		const recovered = await fetch(htmlUrl);
		expect(recovered.status).toBe(200);
		expect(await recovered.text()).toContain('Valid saved HTML');
	});

	it('keeps legacy exports private and read-only without retaining their unused image files', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Legacy export compatibility' });
		expect(created.status).toBe(201);
		const legacyProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${legacyProject.id}`;
		const png = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer());
		const uploaded = await upload(png, 'image/png', 'historical.png', legacyProject.id);
		expect(uploaded.status).toBe(201);
		const oldImage = (await uploaded.json()).asset as ImageAsset;
		const edition = createNewsletter('Current edition without image');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: edition })).status).toBe(201);
		const historical = { ...edition, items: [{ ...createItem(), fields: { image: oldImage.url } }] };
		const legacyId = crypto.randomUUID();
		const legacyHtml = `<html><body><img src="${oldImage.url}"></body></html>`;
		await fixture.pool.query(`
			INSERT INTO newsletter_publications (id, newsletter_id, project_id, content, mjml, html, created_by)
			SELECT $1, id, project_id, $3::jsonb, $4, $5, created_by FROM newsletters WHERE id = $2`,
			[legacyId, edition.id, JSON.stringify(historical), composeNewsletter(DEFAULT_TEMPLATE, null, historical).source, legacyHtml]);
		const download = `${path}/publications/${legacyId}?format=html`;
		expect((await request(download, 'GET', undefined, '')).status).toBe(401);
		expect((await request(download, 'GET', undefined, outsiderCookie)).status).toBe(404);
		expect(await (await request(download)).text()).toBe(legacyHtml);
		expect((await request(`${path}/publications`, 'POST', { newsletterId: edition.id })).status).toBe(405);
		expect((await request(`${path}/assets/${oldImage.id}`, 'DELETE')).status).toBe(200);
		expect((await fetch(oldImage.url)).status).toBe(404);
		expect(await (await request(download)).text()).toBe(legacyHtml);
	});

	it('enforces the configured sign-in attempt threshold', async () => {
		await fixture.pool.query('DELETE FROM "rateLimit"');
		const body = { email: 'owner@example.test', password: 'incorrect-test-password' };
		for (let attempt = 0; attempt < 5; attempt++) {
			expect((await request('/api/auth/sign-in/email', 'POST', body, '')).status).toBe(401);
		}
		expect((await request('/api/auth/sign-in/email', 'POST', body, '')).status).toBe(429);
	});

	it('runs the application with a restricted database role and protects immutable records', async () => {
		const role = await fixture.pool.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = 'postroom_app'");
		expect(role.rows[0].rolsuper).toBe(false);
		const privileges = await fixture.pool.query<{ can_update: boolean; can_delete: boolean }>("SELECT has_table_privilege('postroom_app', 'newsletter_publications', 'UPDATE') AS can_update, has_table_privilege('postroom_app', 'image_assets', 'DELETE') AS can_delete");
		expect(privileges.rows[0]).toEqual({ can_update: false, can_delete: false });
		const associations = await fixture.pool.query<{ can_update: boolean; can_delete: boolean }>("SELECT has_table_privilege('postroom_app', 'newsletter_images', 'UPDATE') AS can_update, has_table_privilege('postroom_app', 'newsletter_images', 'DELETE') AS can_delete");
		expect(associations.rows[0]).toEqual({ can_update: false, can_delete: false });
	});

	it('isolates edition images, validates every input surface, and clones libraries without copying files', async () => {
		const created = await request('/api/projects', 'POST', {
			name: 'Scoped image libraries',
			template: '<mjml><mj-body><mj-section><mj-column><mj-image src="{{image:hero}}" /></mj-column></mj-section>{{items}}</mj-body></mjml>',
			itemTemplate: '<mj-section><mj-column><mj-image src="{{image:photo}}" /></mj-column></mj-section>'
		});
		expect(created.status).toBe(201);
		const scopedProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${scopedProject.id}`;
		async function createEdition(name: string) {
			const value = createNewsletter(name);
			value.items.push(createItem());
			const response = await request(`${path}/newsletters`, 'POST', { newsletter: value });
			expect(response.status).toBe(201);
			return (await response.json()).newsletter as Newsletter;
		}
		const first = await createEdition('First edition');
		const second = await createEdition('Second edition');
		const png = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer());
		const sharedResponse = await upload(png, 'image/png', 'project.png', scopedProject.id);
		const editionResponse = await upload(png, 'image/png', 'first-only.png', scopedProject.id, first.id);
		expect(sharedResponse.status).toBe(201);
		expect(editionResponse.status).toBe(201);
		const shared = (await sharedResponse.json()).asset as ImageAsset;
		const exclusive = (await editionResponse.json()).asset as ImageAsset;
		expect(shared.scope).toBe('project');
		expect(exclusive.scope).toBe('edition');
		async function library(id?: string) {
			const response = await request(`${path}/assets${id ? `?newsletterId=${id}` : ''}`);
			expect(response.status).toBe(200);
			return (await response.json()).assets as ImageAsset[];
		}
		expect((await library()).map((asset) => asset.id)).toEqual([shared.id]);
		expect((await library(first.id)).map((asset) => asset.id).sort()).toEqual([shared.id, exclusive.id].sort());
		expect((await library(second.id)).map((asset) => asset.id)).toEqual([shared.id]);
		const grouped = await request(`${path}/assets?includeEditions=true`);
		expect((await grouped.json()).editionAssets[first.id].map((asset: ImageAsset) => asset.id)).toEqual([exclusive.id]);
		expect((await request(`${path}/assets?newsletterId=invalid`)).status).toBe(400);
		expect((await request(`${path}/assets?newsletterId=${crypto.randomUUID()}`)).status).toBe(404);
		expect((await request(`${path}/assets?newsletterId=${first.id}`, 'GET', undefined, outsiderCookie)).status).toBe(404);
		expect((await upload(png, 'image/png', 'unsaved.png', scopedProject.id, crypto.randomUUID())).status).toBe(404);
		expect((await upload(png, 'image/png', 'wrong-project.png', project.id, first.id)).status).toBe(404);
		expect((await upload(png, 'image/png', 'outsider.png', scopedProject.id, first.id, outsiderCookie)).status).toBe(404);
		const firstContent = {
			...first, fields: { hero: exclusive.url },
			items: [{ ...first.items[0], fields: { photo: exclusive.url } }]
		};
		const updated = await request(`${path}/newsletters/${first.id}`, 'PATCH', { newsletter: firstContent, revision: 1 });
		expect(updated.status).toBe(200);
		for (const invalid of [
			{ ...second, fields: { hero: exclusive.url } },
			{ ...second, items: [{ ...second.items[0], fields: { photo: exclusive.url } }] },
			{ ...second, items: [{ ...second.items[0], fields: { unusedPhoto: exclusive.url } }] }
		]) {
			expect((await request(`${path}/newsletters/${second.id}`, 'PATCH', { newsletter: invalid, revision: 1 })).status).toBe(400);
		}
		const secondSaved = await request(`${path}/newsletters/${second.id}`, 'PATCH', {
			newsletter: { ...second, fields: { hero: shared.url }, items: [{ ...second.items[0], fields: { photo: shared.url } }] }, revision: 1
		});
		expect(secondSaved.status).toBe(200);
		const clone = cloneNewsletter(firstContent, 'First edition clone');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: clone })).status).toBe(400);
		expect((await request(`/api/projects/${project.id}/newsletters`, 'POST', { newsletter: clone, cloneSourceId: first.id })).status).toBe(404);
		const cloned = await request(`${path}/newsletters`, 'POST', { newsletter: clone, cloneSourceId: first.id });
		expect(cloned.status).toBe(201);
		const cloneResult = await cloned.json();
		expect(cloneResult.editionAssets.map((asset: ImageAsset) => asset.id)).toEqual([exclusive.id]);
		expect(cloneResult.newsletter.items[0].fields.photo).toBe(exclusive.url);
		expect((await library(clone.id)).map((asset) => asset.id).sort()).toEqual([shared.id, exclusive.id].sort());
		const counts = await fixture.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM image_assets WHERE project_id = $1', [scopedProject.id]);
		expect(counts.rows[0].count).toBe(2);
		const htmlUrl = await permalink(scopedProject.id, clone.id);
		const html = await (await fetch(htmlUrl)).text();
		expect(html).toContain(exclusive.url);
		const lateSource = await upload(png, 'image/png', 'late-source.png', scopedProject.id, first.id);
		const lateAsset = (await lateSource.json()).asset as ImageAsset;
		expect(lateSource.status).toBe(201);
		expect((await library(clone.id)).some((asset) => asset.id === lateAsset.id)).toBe(false);
		const cloneOnly = await upload(png, 'image/png', 'clone-only.png', scopedProject.id, clone.id);
		const cloneAsset = (await cloneOnly.json()).asset as ImageAsset;
		expect(cloneOnly.status).toBe(201);
		expect((await library(first.id)).some((asset) => asset.id === cloneAsset.id)).toBe(false);
		expect((await library(second.id)).some((asset) => asset.id === cloneAsset.id)).toBe(false);
		expect(await (await fetch(htmlUrl)).text()).toBe(html);
		expect((await fetch(exclusive.url)).status).toBe(200);
	});

	it('deletes only unused current images, preserves other libraries, and supports failed-file deletion retries', async () => {
		const created = await request('/api/projects', 'POST', { name: 'Image deletion checks' });
		const deletionProject = (await created.json()).project as RemoteProject;
		const path = `/api/projects/${deletionProject.id}`;
		const first = createNewsletter('Original library');
		first.items.push(createItem());
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: first })).status).toBe(201);
		const png = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426838' } }).png().toBuffer());
		async function addImage(name: string, editionId?: string) {
			const response = await upload(png, 'image/png', name, deletionProject.id, editionId);
			expect(response.status).toBe(201);
			return (await response.json()).asset as ImageAsset;
		}
		const projectImage = await addImage('unused-project.png');
		const editionImage = await addImage('unused-edition.png', first.id);
		const protectedImage = await addImage('exported-image.png');
		const clone = cloneNewsletter(first, 'Cloned library');
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: clone, cloneSourceId: first.id })).status).toBe(201);
		const editionDelete = `${path}/assets/${editionImage.id}`;
		expect((await request(editionDelete, 'DELETE')).status).toBe(404);
		expect((await request(`${editionDelete}?newsletterId=${first.id}`, 'DELETE', undefined, outsiderCookie)).status).toBe(404);
		expect((await request(`${path}/assets/${projectImage.id}`, 'DELETE', undefined, ownerCookie, 'https://untrusted.example')).status).toBe(403);
		const firstRemoved = await request(`${editionDelete}?newsletterId=${first.id}`, 'DELETE');
		expect(firstRemoved.status).toBe(200);
		expect((await firstRemoved.json()).fileDeleted).toBe(false);
		expect((await fetch(editionImage.url)).status).toBe(200);
		const originalLibrary = await request(`${path}/assets?newsletterId=${first.id}`);
		expect((await originalLibrary.json()).assets.some((asset: ImageAsset) => asset.id === editionImage.id)).toBe(false);
		const clonedLibrary = await request(`${path}/assets?newsletterId=${clone.id}`);
		expect((await clonedLibrary.json()).assets.some((asset: ImageAsset) => asset.id === editionImage.id)).toBe(true);
		const lastRemoved = await request(`${editionDelete}?newsletterId=${clone.id}`, 'DELETE');
		expect(lastRemoved.status).toBe(200);
		expect((await lastRemoved.json()).fileDeleted).toBe(true);
		expect((await fetch(editionImage.url)).status).toBe(404);
		expect((await request(`${editionDelete}?newsletterId=${clone.id}`, 'DELETE')).status).toBe(200);
		const used = { ...first, items: [{ ...first.items[0], fields: { image: protectedImage.url } }] };
		expect((await request(`${path}/newsletters/${first.id}`, 'PATCH', { newsletter: used, revision: 1 })).status).toBe(200);
		expect((await request(`${path}/assets/${protectedImage.id}`, 'DELETE')).status).toBe(409);
		const htmlUrl = await permalink(deletionProject.id, first.id);
		expect(await (await fetch(htmlUrl)).text()).toContain(protectedImage.url);
		expect((await request(`${path}/newsletters/${first.id}`, 'PATCH', { newsletter: first, revision: 2 })).status).toBe(200);
		expect((await request(`${path}/assets/${protectedImage.id}`, 'DELETE')).status).toBe(200);
		expect(await (await fetch(htmlUrl)).text()).not.toContain(protectedImage.url);
		expect((await fetch(protectedImage.url)).status).toBe(404);
		const referencingTemplate = deletionProject.template.replace('{{items}}', `<mj-section><mj-column><mj-image src="${projectImage.url}" /></mj-column></mj-section>{{items}}`);
		expect((await request(path, 'PATCH', { name: deletionProject.name, template: referencingTemplate, itemTemplate: null, revision: 1 })).status).toBe(200);
		expect((await request(`${path}/assets/${projectImage.id}`, 'DELETE')).status).toBe(409);
		expect((await request(path, 'PATCH', { name: deletionProject.name, template: deletionProject.template, itemTemplate: null, revision: 2 })).status).toBe(200);
		const unrelatedMetadata = createNewsletter(`Image id note: ${projectImage.id}`);
		unrelatedMetadata.id = projectImage.id;
		expect((await request(`${path}/newsletters`, 'POST', { newsletter: unrelatedMetadata })).status).toBe(201);
		const deleted = await request(`${path}/assets/${projectImage.id}`, 'DELETE');
		expect(deleted.status).toBe(200);
		expect((await deleted.json()).fileDeleted).toBe(true);
		expect((await fetch(projectImage.url)).status).toBe(404);
		expect((await request(path, 'PATCH', { name: deletionProject.name, template: referencingTemplate, itemTemplate: null, revision: 3 })).status).toBe(400);
		const resurrected = { ...first, fields: { photo: projectImage.url } };
		expect((await request(`${path}/newsletters/${first.id}`, 'PATCH', { newsletter: resurrected, revision: 3 })).status).toBe(400);
		const retryImage = await addImage('retry-file-deletion.png');
		const file = join(fixture.directory, 'uploads', `${retryImage.id}.webp`);
		const backup = `${file}.backup`;
		await rename(file, backup);
		await mkdir(file);
		try {
			const failed = await request(`${path}/assets/${retryImage.id}`, 'DELETE');
			expect(failed.status).toBe(500);
			expect((await failed.json()).message).toContain('file deletion failed');
			const library = await request(`${path}/assets`);
			expect((await library.json()).assets.some((asset: ImageAsset) => asset.id === retryImage.id)).toBe(false);
		} finally {
			await rmdir(file);
			await rename(backup, file);
		}
		expect((await request(`${path}/assets/${retryImage.id}`, 'DELETE')).status).toBe(200);
		expect((await fetch(retryImage.url)).status).toBe(404);
	});
});
