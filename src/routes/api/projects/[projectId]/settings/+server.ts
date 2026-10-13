import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { projectName, requireProject, transaction } from '#lib/server/workspace.js';

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const id = uuid(event.params.projectId);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => !['name', 'revision'].includes(key))) error(400, 'Send only the project name and saved revision.');
	const name = projectName(body.name);
	const expected = revision(body.revision);
	const project = await transaction(pool, async (client) => {
		const current = await requireProject(client, id, user.id, true);
		if (current.revision !== expected) error(409, 'This project changed elsewhere. Reload before saving the project name.');
		await client.query('UPDATE projects SET name = $2, revision = revision + 1, updated_at = now() WHERE id = $1', [id, name]);
		return { ...current, name, revision: expected + 1 };
	});
	return json({ project });
});
