import { json } from '@sveltejs/kit';
import { api, requireUser, uuid } from '#lib/server/http.js';
import { requireProject } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	await requireProject(pool, projectId, user.id);
	const result = await pool.query<{ id: string; newsletter_id: string; name: string; created_at: Date }>("SELECT id, newsletter_id, content->>'name' AS name, created_at FROM newsletter_publications WHERE project_id = $1 ORDER BY created_at DESC", [projectId]);
	return json({ publications: result.rows.map((row) => ({ id: row.id, newsletterId: row.newsletter_id, name: row.name, createdAt: row.created_at.toISOString() })) });
});
