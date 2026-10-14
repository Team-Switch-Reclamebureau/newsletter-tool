import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { api, rateLimit, readJson, requireUser } from '#lib/server/http.js';
import { listSignatures, signatureName } from '#lib/server/signatures.js';
import type { EmailSignature } from '#lib/signatures.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	return json({ signatures: await listSignatures(pool, user.id) });
});

export const POST = api(async (event) => {
	const { pool, user } = requireUser(event);
	await rateLimit(pool, `signatures:${user.id}`, 30);
	const name = signatureName((await readJson(event.request)).name);
	const result = await pool.query<EmailSignature>('INSERT INTO email_signatures(id, user_id, name) VALUES ($1, $2, $3) RETURNING id, name, revision', [randomUUID(), user.id, name]);
	return json({ signature: { ...result.rows[0], variations: [], contacts: [] } }, { status: 201 });
});
