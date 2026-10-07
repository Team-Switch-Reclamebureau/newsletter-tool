import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, uuid } from '#lib/server/http.js';
import { listAssets, newsletterInput, requireNewsletter, requireProject, resolveAssets, transaction, validateNewsletterFields, type NewsletterRow } from '#lib/server/workspace.js';
import { newsletterHtmlUrl } from '#lib/remote.js';

export const GET = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	await requireProject(pool, projectId, user.id);
	const result = await pool.query<NewsletterRow & { public_id: string }>('SELECT id, content, revision, public_id FROM newsletters WHERE project_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC, id', [projectId]);
	return json({ newsletters: result.rows.map((row) => ({ newsletter: row.content, revision: row.revision, permalink: newsletterHtmlUrl(config.origin, row.public_id) })) });
});

export const POST = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const body = await readJson(event.request);
	const input = newsletterInput(body.newsletter);
	uuid(input.id);
	const cloneSourceId = body.cloneSourceId === undefined ? undefined : uuid(typeof body.cloneSourceId === 'string' ? body.cloneSourceId : undefined);
	const result = await transaction(pool, async (client) => {
		const project = await requireProject(client, projectId, user.id, true);
		if (cloneSourceId) await requireNewsletter(client, projectId, cloneSourceId);
		const timestamp = new Date().toISOString();
		const newsletter = await resolveAssets(client, projectId, { ...input, createdAt: timestamp, updatedAt: timestamp }, config.origin, cloneSourceId ?? input.id);
		validateNewsletterFields(project, newsletter);
		const inserted = await client.query<{ public_id: string }>('INSERT INTO newsletters(id, project_id, content, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING public_id', [newsletter.id, projectId, newsletter, user.id]);
		if (!inserted.rowCount) error(409, 'This newsletter id already exists. Export your draft, then reload the project.');
		if (cloneSourceId) {
			await client.query(`
				INSERT INTO newsletter_images(project_id, newsletter_id, image_asset_id)
				SELECT n.project_id, $1, n.image_asset_id FROM newsletter_images n
				JOIN image_assets a ON a.id = n.image_asset_id
				WHERE n.newsletter_id = $2 AND n.project_id = $3 AND n.removed_at IS NULL AND a.deleted_at IS NULL`, [newsletter.id, cloneSourceId, projectId]);
		}
		return {
			newsletter, revision: 1,
			permalink: newsletterHtmlUrl(config.origin, inserted.rows[0].public_id),
			editionAssets: (await listAssets(client, projectId, config.origin, newsletter.id)).filter((asset) => asset.scope === 'edition')
		};
	});
	return json(result, { status: 201 });
});
