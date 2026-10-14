import { api, requireUser, uuid } from '#lib/server/http.js';
import { renderSavedSignature, requireSignature } from '#lib/server/signatures.js';
import { signatureDownloadName } from '#lib/signatures.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const id = uuid(event.params.signatureId);
	const signature = await requireSignature(pool, id, user.id);
	const rendered = await renderSavedSignature(pool, id, uuid(event.url.searchParams.get('variationId') ?? undefined), uuid(event.url.searchParams.get('contactId') ?? undefined));
	return new Response(rendered.html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': `attachment; filename="${signatureDownloadName(signature.name, rendered.variation.name, rendered.contact.fields.name)}"`,
			'Content-Security-Policy': "sandbox; default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
			'Cache-Control': 'no-store'
		}
	});
});
