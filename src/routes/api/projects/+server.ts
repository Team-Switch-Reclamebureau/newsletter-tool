import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { api, readJson, requireUser, rateLimit } from '#lib/server/http.js';
import { listProjects, projectInput, transaction, validateHostedImageReferences } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	return json({ projects: await listProjects(pool, user.id) });
});

export const POST = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	await rateLimit(pool, `projects:${user.id}`, 30);
	const input = projectInput(await readJson(event.request));
	const project = await transaction(pool, async (client) => {
		await validateHostedImageReferences(client, `${input.template}\n${input.snippet ?? ''}`, config.origin);
		const id = randomUUID();
		await client.query('INSERT INTO projects(id, name, template, item_template, created_by) VALUES ($1, $2, $3, $4, $5)', [id, input.name, input.template, input.snippet, user.id]);
		await client.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1, $2, 'owner')", [id, user.id]);
		return { id, name: input.name, template: input.template, itemTemplate: input.snippet, revision: 1, role: 'owner' };
	});
	return json({ project }, { status: 201 });
});
