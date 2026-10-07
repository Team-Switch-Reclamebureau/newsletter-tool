import { error } from '@sveltejs/kit';
import type { Pool, PoolClient } from 'pg';
import { parseNewsletter, templateValuesError, validHttpUrl, type Newsletter } from '../newsletters';
import { templateFields } from '../template-fields';
import { DEFAULT_TEMPLATE, MAX_TEMPLATE_BYTES, UUID_PATTERN, imageAssetUrl, type ImageAsset, type RemoteProject } from '../remote';
import { validateSource } from './render';

type Database = Pool | PoolClient;
interface ProjectRow {
	id: string; name: string; template: string; item_template: string | null;
	revision: number; role: RemoteProject['role'];
}
interface AssetRow {
	scope: ImageAsset['scope'];
	id: string; project_id: string; original_name: string;
	width: number; height: number; bytes: number; created_at: Date;
}
export interface NewsletterRow {
	id: string; content: Newsletter; revision: number;
}

export function projectFromRow(row: ProjectRow): RemoteProject {
	return { id: row.id, name: row.name, template: row.template, itemTemplate: row.item_template, revision: row.revision, role: row.role };
}

export async function listProjects(database: Database, userId: string) {
	const result = await database.query<ProjectRow>(`
		SELECT p.*, m.role FROM projects p JOIN project_members m ON m.project_id = p.id
		WHERE m.user_id = $1 ORDER BY p.name, p.id`, [userId]);
	return result.rows.map(projectFromRow);
}

export async function requireProject(database: Database, projectId: string, userId: string, lock = false) {
	const result = await database.query<ProjectRow>(`
		SELECT p.*, m.role FROM projects p JOIN project_members m ON m.project_id = p.id
		WHERE p.id = $1 AND m.user_id = $2 ${lock ? 'FOR UPDATE OF p' : ''}`, [projectId, userId]);
	if (!result.rows[0]) error(404, 'Project not found or access was not granted.');
	return projectFromRow(result.rows[0]);
}

export function projectInput(value: Record<string, unknown>) {
	const name = typeof value.name === 'string' ? value.name.trim() : '';
	if (!name || name.length > 160) error(400, 'Project names must contain 1–160 characters.');
	const template = value.template === undefined ? DEFAULT_TEMPLATE : value.template;
	if (typeof template !== 'string') error(400, 'An MJML template is required.');
	const message = validateSource(template);
	if (message) error(400, message);
	const snippet = value.itemTemplate === undefined || value.itemTemplate === '' ? null : value.itemTemplate;
	if (snippet !== null && (typeof snippet !== 'string' || new TextEncoder().encode(snippet).length > MAX_TEMPLATE_BYTES)) {
		error(400, 'The item template must be MJML text no larger than 1 MB.');
	}
	if (typeof snippet === 'string' && /<mj-include(?:\s|\/|>)/i.test(snippet)) error(400, 'mj-include is not supported.');
	for (const schema of [templateFields(template, 'template'), templateFields(snippet ?? '', 'item')]) {
		if (schema.error) error(400, schema.error);
	}
	return { name, template, snippet };
}

export function validateNewsletterFields(project: RemoteProject, newsletter: Newsletter) {
	const message = templateValuesError(project.template, project.itemTemplate, newsletter);
	if (message) error(400, message);
}

export function newsletterInput(value: unknown): Newsletter {
	let newsletter: Newsletter;
	try { newsletter = parseNewsletter(JSON.stringify(value, null, 2)); }
	catch (cause) { error(400, cause instanceof Error ? cause.message : 'Invalid newsletter data.'); }
	return newsletter;
}

export async function requireNewsletter(database: Database, projectId: string, newsletterId: string) {
	const result = await database.query<NewsletterRow>('SELECT id, content, revision FROM newsletters WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL', [newsletterId, projectId]);
	if (!result.rows[0]) error(404, 'The edition was not found in this project. Save the edition before uploading edition images.');
	return result.rows[0];
}

function assetFromRow(row: AssetRow, origin: string): ImageAsset {
	return {
		scope: row.scope,
		id: row.id, projectId: row.project_id, filename: row.original_name,
		url: imageAssetUrl(origin, row.id), width: row.width, height: row.height,
		bytes: row.bytes, createdAt: row.created_at.toISOString()
	};
}

export async function listAssets(database: Database, projectId: string, origin: string, newsletterId?: string): Promise<ImageAsset[]> {
	const result = await database.query<AssetRow>(`
		SELECT a.* FROM image_assets a WHERE a.project_id = $1 AND a.deleted_at IS NULL AND (
			a.scope = 'project' OR (a.scope = 'edition' AND EXISTS (
				SELECT 1 FROM newsletter_images n WHERE n.image_asset_id = a.id AND n.newsletter_id = $2 AND n.removed_at IS NULL
			))
		) ORDER BY a.created_at DESC, a.id`, [projectId, newsletterId ?? null]);
	return result.rows.map((row) => assetFromRow(row, origin));
}

export async function listEditionAssets(database: Database, projectId: string, origin: string): Promise<Record<string, ImageAsset[]>> {
	const result = await database.query<AssetRow & { newsletter_id: string }>(`
		SELECT a.*, n.newsletter_id FROM image_assets a
		JOIN newsletter_images n ON n.image_asset_id = a.id AND n.project_id = a.project_id
		WHERE a.project_id = $1 AND a.scope = 'edition' AND a.deleted_at IS NULL AND n.removed_at IS NULL
		ORDER BY a.created_at DESC, a.id`, [projectId]);
	const editions: Record<string, ImageAsset[]> = {};
	for (const row of result.rows) {
		(editions[row.newsletter_id] ??= []).push(assetFromRow(row, origin));
	}
	return editions;
}

export async function validateHostedImageReferences(database: Database, source: string, origin: string) {
	const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const matches = source.matchAll(new RegExp(`${escapedOrigin}/media/([a-f0-9-]{36})\\.webp`, 'gi'));
	const ids = [...new Set([...matches].map((match) => match[1].toLowerCase()).filter((id) => UUID_PATTERN.test(id)))];
	if (!ids.length) return;
	const result = await database.query<{ id: string }>('SELECT id FROM image_assets WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE', [ids]);
	if (result.rows.length !== ids.length) error(400, 'This content references an image that is no longer available.');
}

export async function resolveAssets(database: Database, projectId: string, newsletter: Newsletter, origin: string, assetEditionId = newsletter.id): Promise<Newsletter> {
	const assets = await listAssets(database, projectId, origin, assetEditionId);
	const available = new Map(assets.map((asset) => [asset.id, asset]));
	function resolveUrl(value: string): string {
		if (!validHttpUrl(value)) return value;
		const url = new URL(value);
		const id = url.origin === origin ? url.pathname.match(/^\/media\/([^/]+)\.webp$/)?.[1] : undefined;
		if (!id || !UUID_PATTERN.test(id)) return value;
		const asset = available.get(id.toLowerCase());
		if (!asset) error(400, 'Choose a project image or an image belonging to this edition.');
		return asset.url;
	}
	function resolveFields(fields: Newsletter['fields']) {
		return fields === undefined ? undefined : Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, resolveUrl(value)]));
	}
	const resolved = {
		...newsletter,
		...(newsletter.fields === undefined ? {} : { fields: resolveFields(newsletter.fields) }),
		items: newsletter.items.map((item) => {
			const fields = item.fields === undefined ? {} : { fields: resolveFields(item.fields) };
			if (!item.imageAssetId) return { ...item, ...fields, image: resolveUrl(item.image) };
			const asset = available.get(item.imageAssetId);
			if (!asset) error(400, 'Choose a project image or an image belonging to this edition.');
			return { ...item, ...fields, image: asset.url };
		})
	};
	return newsletterInput(resolved);
}

export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await operation(client);
		await client.query('COMMIT');
		return result;
	} catch (cause) {
		try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Database rollback failed:', rollbackError); }
		throw cause;
	} finally { client.release(); }
}
