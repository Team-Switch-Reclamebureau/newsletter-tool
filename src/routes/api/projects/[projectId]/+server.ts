import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { projectInput, requireProject, transaction, validateHostedImageReferences } from '#lib/server/workspace.js';

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
