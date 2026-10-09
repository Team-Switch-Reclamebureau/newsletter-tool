import { error, json } from '@sveltejs/kit';
import { api, rateLimit, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { imageInUse } from '#lib/server/image-usage.js';
import { newsletterInput, requireProject, resolveAssets, transaction, validateNewsletterFields, type NewsletterRow } from '#lib/server/workspace.js';
import { newsletterHtmlUrl } from '#lib/remote.js';

export const PATCH = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const id = uuid(event.params.newsletterId);
	const body = await readJson(event.request);
	const expected = revision(body.revision);
	const input = newsletterInput(body.newsletter);
	if (input.id !== id) error(400, 'The newsletter id cannot be changed.');
	const result = await transaction(pool, async (client) => {
		const project = await requireProject(client, projectId, user.id, true);
		const current = await client.query<NewsletterRow & { public_id: string }>('SELECT id, content, revision, public_id FROM newsletters WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL', [id, projectId]);
		if (!current.rows[0]) error(404, 'Newsletter not found.');
		if (current.rows[0].revision !== expected) error(409, 'This newsletter changed elsewhere. Export your draft, then reload before saving.');
		const newsletter = await resolveAssets(client, projectId, {
			...input, createdAt: current.rows[0].content.createdAt, updatedAt: new Date().toISOString()
		}, config.origin);
		validateNewsletterFields(project, newsletter);
		await client.query('UPDATE newsletters SET content = $3, revision = revision + 1, updated_at = now() WHERE id = $1 AND project_id = $2', [id, projectId, newsletter]);
		return { newsletter, revision: expected + 1, permalink: newsletterHtmlUrl(config.origin, current.rows[0].public_id) };
	});
	return json(result);
});

export const DELETE = api(async (event) => {
	const { pool, user, storage } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const id = uuid(event.params.newsletterId);
	const body = await readJson(event.request);
	const expected = revision(body.revision);
	await requireProject(pool, projectId, user.id);
	await rateLimit(pool, `delete-edition:${user.id}`, 30);
	const deletedAssetIds = await transaction(pool, async (client) => {
		await requireProject(client, projectId, user.id, true);
		const current = await client.query<NewsletterRow>('SELECT id, content, revision FROM newsletters WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, projectId]);
		if (!current.rows[0]) error(404, 'Newsletter not found.');
		if (current.rows[0].revision !== expected) error(409, 'This campaign changed elsewhere. Reload before deleting.');
		await client.query('UPDATE newsletters SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1', [id]);
		await client.query('UPDATE newsletter_images SET removed_at = coalesce(removed_at, now()) WHERE newsletter_id = $1 AND project_id = $2', [id, projectId]);
		const assets = await client.query<{ id: string }>(`
			SELECT a.id FROM image_assets a
			JOIN newsletter_images n ON n.image_asset_id = a.id
			WHERE n.newsletter_id = $1 AND a.project_id = $2 AND a.scope = 'edition'
			ORDER BY a.id FOR UPDATE OF a`, [id, projectId]);
		const removed: string[] = [];
		for (const asset of assets.rows) {
			const remaining = await client.query('SELECT 1 FROM newsletter_images WHERE image_asset_id = $1 AND removed_at IS NULL LIMIT 1', [asset.id]);
			if (remaining.rowCount || await imageInUse(client, asset.id)) continue;
			await client.query('UPDATE image_assets SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1', [asset.id]);
			removed.push(asset.id);
		}
		return removed;
	});
	for (const assetId of deletedAssetIds) {
		try { await storage.removePermanent(assetId); }
		catch (cause) {
			console.error('Could not remove deleted edition image:', id, assetId, cause);
			error(500, 'The campaign was deleted, but image cleanup failed. Retry Delete campaign to finish cleanup or contact your administrator.');
		}
	}
	return json({ deletedAssetIds, message: 'Campaign deleted. Its HTML permalink is no longer available; unused campaign images were removed.' });
});
