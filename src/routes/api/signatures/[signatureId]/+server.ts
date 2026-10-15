import { error, json } from '@sveltejs/kit';
import { api, readJson, requireAdmin, requireUser, revision, uuid } from '#lib/server/http.js';
import { mutateSignature, requireSignature, signatureDetail, signatureDownloadLinkText, signatureInstructions, signatureName } from '#lib/server/signatures.js';
import { transaction } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const signature = await requireSignature(pool, uuid(event.params.signatureId), user.id);
	return json({ signature: await signatureDetail(pool, signature) });
});

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	if (!['name', 'instructionText', 'downloadLinkText'].some((key) => Object.hasOwn(body, key))) error(400, 'Provide a signature name, instruction email text, or download link text.');
	const name = Object.hasOwn(body, 'name') ? signatureName(body.name) : undefined;
	const instructions = Object.hasOwn(body, 'instructionText') ? signatureInstructions(body.instructionText) : undefined;
	const downloadLinkText = Object.hasOwn(body, 'downloadLinkText') ? signatureDownloadLinkText(body.downloadLinkText) : undefined;
	const signature = await mutateSignature(pool, uuid(event.params.signatureId), user.id, body.revision, async (client, current) => {
		await client.query('UPDATE email_signatures SET name = COALESCE($2, name), instruction_text = COALESCE($3, instruction_text), download_link_text = COALESCE($4, download_link_text) WHERE id = $1', [current.id, name, instructions, downloadLinkText]);
	});
	return json({ signature });
});

export const DELETE = api(async (event) => {
	const { pool, user } = requireAdmin(event);
	const body = await readJson(event.request);
	const expected = revision(body.revision);
	await transaction(pool, async (client) => {
		const signature = await requireSignature(client, uuid(event.params.signatureId), user.id, true);
		if (!(await client.query('SELECT user_id FROM application_admins WHERE user_id = $1', [user.id])).rowCount) error(403, 'Only administrators can delete signatures.');
		if (signature.revision !== expected) error(409, 'This signature changed since you loaded it. Reload before deleting.');
		if (body.confirmName !== signature.name) error(400, 'Type the exact saved signature name to confirm deletion.');
		await client.query('DELETE FROM email_signatures WHERE id = $1', [signature.id]);
	});
	return json({ deleted: true });
});
