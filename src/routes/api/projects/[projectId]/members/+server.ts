import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, uuid } from '#lib/server/http.js';
import { listProjectMembers, requireProject, transaction } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	await requireProject(pool, projectId, user.id);
	return json({ members: await listProjectMembers(pool, projectId) });
});

export const POST = api(async (event) => {
	const { pool, user } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const body = await readJson(event.request);
	if (typeof body.email !== 'string') error(400, 'Enter the email address of a provisioned user.');
	const email = body.email.trim().toLowerCase();
	const members = await transaction(pool, async (client) => {
		await requireProject(client, projectId, user.id, true);
		const account = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = $1', [email]);
		if (!account.rows[0]) error(404, 'This user has not been provisioned. Ask your administrator to create their account first.');
		await client.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1, $2, 'editor') ON CONFLICT DO NOTHING", [projectId, account.rows[0].id]);
		return listProjectMembers(client, projectId);
	});
	return json({ members, message: 'The user now has access to this project.' });
});
