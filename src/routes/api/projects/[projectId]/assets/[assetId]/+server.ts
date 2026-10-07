import { error, json } from '@sveltejs/kit';
import { api, rateLimit, requireUser, uuid } from '#lib/server/http.js';
import { requireNewsletter, requireProject, transaction } from '#lib/server/workspace.js';
import { type ImageScope } from '#lib/remote.js';
import { imageInUse } from '#lib/server/image-usage.js';

export const DELETE = api(async (event) => {
	const { pool, user, storage } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const assetId = uuid(event.params.assetId);
	const selected = event.url.searchParams.get('newsletterId');
	const newsletterId = selected === null ? undefined : uuid(selected);
	await requireProject(pool, projectId, user.id);
	await rateLimit(pool, `delete-image:${user.id}`, 30);
	const fileDeleted = await transaction(pool, async (client) => {
		await requireProject(client, projectId, user.id, true);
		if (newsletterId) await requireNewsletter(client, projectId, newsletterId);
		const result = await client.query<{ scope: ImageScope }>('SELECT scope FROM image_assets WHERE id = $1 AND project_id = $2 FOR UPDATE', [assetId, projectId]);
		const asset = result.rows[0];
		if (!asset || asset.scope !== (newsletterId ? 'edition' : 'project')) error(404, 'Image not found in this library.');
		if (newsletterId) {
			const association = await client.query('SELECT 1 FROM newsletter_images WHERE project_id = $1 AND newsletter_id = $2 AND image_asset_id = $3', [projectId, newsletterId, assetId]);
			if (!association.rowCount) error(404, 'Image not found in this edition library.');
		}
		if (await imageInUse(client, assetId)) error(409, 'This image is used by a current saved edition or template and cannot be deleted.');
		if (newsletterId) {
			await client.query('UPDATE newsletter_images SET removed_at = coalesce(removed_at, now()) WHERE newsletter_id = $1 AND image_asset_id = $2', [newsletterId, assetId]);
			const remaining = await client.query('SELECT 1 FROM newsletter_images WHERE image_asset_id = $1 AND removed_at IS NULL LIMIT 1', [assetId]);
			if (remaining.rowCount) return false;
		}
		await client.query('UPDATE image_assets SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1', [assetId]);
		return true;
	});
	if (fileDeleted) {
		try { await storage.removePermanent(assetId); }
		catch (cause) {
			console.error('Could not permanently remove image:', assetId, cause);
			error(500, 'The image was removed from the library, but file deletion failed. Retry Delete or contact your administrator.');
		}
	}
	return json({
		fileDeleted,
		message: fileDeleted ? 'Unused image deleted permanently.' : 'Image removed from this edition library. Other edition libraries still use the stored file.'
	});
});
