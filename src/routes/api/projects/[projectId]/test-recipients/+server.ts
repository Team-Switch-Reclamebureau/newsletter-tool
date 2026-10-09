import { error, json } from '@sveltejs/kit';
import { parseTestRecipients } from '#lib/test-recipients.js';
import { api, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { readTestRecipients } from '#lib/server/test-recipients.js';
import { requireProject, transaction } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const id = uuid(event.params.projectId);
	await requireProject(pool, id, user.id);
	return json({ settings: await readTestRecipients(pool, id) });
});

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const id = uuid(event.params.projectId);
	await requireProject(pool, id, user.id);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => !['recipients', 'revision'].includes(key))) error(400, 'Send only recipients and their saved revision.');
	let recipients: string[];
	try { recipients = parseTestRecipients(body.recipients); }
	catch (cause) { error(400, cause instanceof Error ? cause.message : 'Enter valid test recipients.'); }
	const expected = revision(body.revision);
	const settings = await transaction(pool, async (client) => {
		await requireProject(client, id, user.id, true);
		const current = await readTestRecipients(client, id);
		if (current.revision !== expected) error(409, 'Test recipients changed elsewhere. Reload the project before saving.');
		await client.query(`
			INSERT INTO project_test_recipients(project_id, recipients, revision) VALUES ($1, $2, $3)
			ON CONFLICT (project_id) DO UPDATE SET recipients = EXCLUDED.recipients, revision = EXCLUDED.revision`,
			[id, recipients, expected + 1]);
		return { recipients, revision: expected + 1 };
	});
	return json({ settings });
});
