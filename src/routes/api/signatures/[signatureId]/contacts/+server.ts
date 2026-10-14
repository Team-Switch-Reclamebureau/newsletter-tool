import { json } from '@sveltejs/kit';
import { api, rateLimit, readJson, requireUser, uuid } from '#lib/server/http.js';
import { mutateSignature, saveContact } from '#lib/server/signatures.js';

export const POST = api(async (event) => {
	const { pool, user } = requireUser(event);
	await rateLimit(pool, `signature-contacts:${user.id}`, 60);
	const body = await readJson(event.request);
	const signature = await mutateSignature(pool, uuid(event.params.signatureId), user.id, body.revision, (client, current) => saveContact(client, current.id, body));
	return json({ signature }, { status: 201 });
});
