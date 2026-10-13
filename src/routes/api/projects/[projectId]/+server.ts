import { error, json } from '@sveltejs/kit';
import { api, rateLimit, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { projectInput, requireProject, transaction, validateHostedImageReferences } from '#lib/server/workspace.js';
import { imageInUse } from '#lib/server/image-usage.js';

export const DELETE = api(async (event) => {
	const { pool, user, storage } = requireUser(event);
	const id = uuid(event.params.projectId);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => !['confirmName', 'revision'].includes(key))) error(400, 'Send only the confirmation name and saved revision.');
	const expected = revision(body.revision);
	await rateLimit(pool, `delete-project:${user.id}`, 30);
	const deletedAssetIds = await transaction(pool, async (client) => {
		const current = await requireProject(client, id, user.id, true, true);
		if (current.role !== 'owner') error(403, 'Only the project owner can delete this project.');
		if (current.revision !== expected) error(409, 'This project changed elsewhere. Reload before deleting.');
		if (body.confirmName !== current.name) error(400, 'Type the exact saved project name to confirm deletion.');
		await client.query('UPDATE projects SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1', [id]);
		await client.query('UPDATE newsletters SET deleted_at = coalesce(deleted_at, now()) WHERE project_id = $1', [id]);
		await client.query('UPDATE newsletter_images SET removed_at = coalesce(removed_at, now()) WHERE project_id = $1', [id]);
		const assets = await client.query<{ id: string }>('SELECT id FROM image_assets WHERE project_id = $1 ORDER BY id FOR UPDATE', [id]);
		for (const asset of assets.rows) {
			if (await imageInUse(client, asset.id)) error(409, 'A project image is still used by another project. Remove those references before deleting this project.');
		}
		await client.query('UPDATE image_assets SET deleted_at = coalesce(deleted_at, now()) WHERE project_id = $1', [id]);
		return assets.rows.map((asset) => asset.id);
	});
	for (const assetId of deletedAssetIds) {
		try { await storage.removePermanent(assetId); }
		catch (cause) {
			console.error('Could not remove deleted project image:', id, assetId, cause);
			error(500, 'Project deletion started, but image cleanup failed. Open Project settings and retry Delete project to finish cleanup.');
		}
	}
	await transaction(pool, async (client) => {
		const current = await requireProject(client, id, user.id, true, true);
		if (current.role !== 'owner') error(403, 'Only the project owner can finish deleting this project.');
		await client.query('UPDATE projects SET deletion_completed_at = coalesce(deletion_completed_at, now()) WHERE id = $1', [id]);
	});
	return json({ deletedAssetIds, message: 'Project deleted. Its campaigns and HTML links are no longer available, and its image files were permanently removed.' });
});

export const PATCH = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const id = uuid(event.params.projectId);
	const body = await readJson(event.request);
	if (!('template' in body) || !('itemTemplate' in body)) error(400, 'Send the project name, template, and item template together.');
	const input = projectInput(body);
	const expected = revision(body.revision);
	const project = await transaction(pool, async (client) => {
		const current = await requireProject(client, id, user.id, true);
		if (current.revision !== expected) error(409, 'This project changed elsewhere. Reload before saving your template.');
		await validateHostedImageReferences(client, `${input.template}\n${input.snippet ?? ''}`, config.origin);
		await client.query('UPDATE projects SET name = $2, template = $3, item_template = $4, revision = revision + 1, updated_at = now() WHERE id = $1', [id, input.name, input.template, input.snippet]);
		return { ...current, name: input.name, template: input.template, itemTemplate: input.snippet, revision: expected + 1 };
	});
	return json({ project });
});
