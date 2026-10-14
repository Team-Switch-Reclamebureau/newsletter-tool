import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser, uuid } from '#lib/server/http.js';
import { mutateSignature, saveContact } from '#lib/server/signatures.js';

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	const id = uuid(event.params.contactId);
	const signature = await mutateSignature(pool, uuid(event.params.signatureId), user.id, body.revision, (client, current) => saveContact(client, current.id, body, id));
	return json({ signature });
});

export const DELETE = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	const id = uuid(event.params.contactId);
	const signature = await mutateSignature(pool, uuid(event.params.signatureId), user.id, body.revision, async (client, current) => {
		const result = await client.query('DELETE FROM signature_contacts WHERE signature_id = $1 AND id = $2', [current.id, id]);
		if (!result.rowCount) error(404, 'Contact not found in this signature.');
	});
	return json({ signature });
});
