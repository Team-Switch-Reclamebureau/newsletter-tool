import { error, json } from '@sveltejs/kit';
import { api, requireUser, uuid } from '#lib/server/http.js';
import { listProjectMembers, requireProject, transaction } from '#lib/server/workspace.js';

export const DELETE = api(async (event) => {
	const { pool, user } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const memberId = event.params.memberId;
	if (!memberId) error(400, 'A member id is required.');
	const members = await transaction(pool, async (client) => {
		const project = await requireProject(client, projectId, user.id, true);
		if (project.role !== 'owner') error(403, 'Only the project owner can remove members.');
		const target = await client.query<{ role: string }>('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [projectId, memberId]);
		if (!target.rows[0]) error(404, 'Member not found. Refresh the member list.');
		if (target.rows[0].role === 'owner') error(400, 'The project owner cannot be removed.');
		await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, memberId]);
		return listProjectMembers(client, projectId);
	});
	return json({ members, message: 'Project access removed. The account and existing content have been kept.' });
});
