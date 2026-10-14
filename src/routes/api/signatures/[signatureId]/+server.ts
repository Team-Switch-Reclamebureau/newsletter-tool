import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { mutateSignature, requireSignature, signatureDetail, signatureName } from '#lib/server/signatures.js';
import { transaction } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const signature = await requireSignature(pool, uuid(event.params.signatureId), user.id);
	return json({ signature: await signatureDetail(pool, signature) });
});

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	const name = signatureName(body.name);
	const signature = await mutateSignature(pool, uuid(event.params.signatureId), user.id, body.revision, async (client, current) => {
		await client.query('UPDATE email_signatures SET name = $2 WHERE id = $1', [current.id, name]);
	});
	return json({ signature });
});

export const DELETE = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	const expected = revision(body.revision);
	await transaction(pool, async (client) => {
		const signature = await requireSignature(client, uuid(event.params.signatureId), user.id, true);
		if (signature.revision !== expected) error(409, 'This signature changed since you loaded it. Reload before deleting.');
		if (body.confirmName !== signature.name) error(400, 'Type the exact saved signature name to confirm deletion.');
		await client.query('DELETE FROM email_signatures WHERE id = $1', [signature.id]);
	});
	return json({ deleted: true });
});
