import { error } from '@sveltejs/kit';
import { UUID_PATTERN } from '#lib/remote.js';
import { api, rateLimit } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';

export const GET = api(async (event) => {
	const token = event.params.token;
	if (!token || !UUID_PATTERN.test(token)) error(404, 'Signature download not found.');
	const runtime = getRuntime();
	if (!runtime) error(503, 'The signature workspace is unavailable.');
	const result = await runtime.pool.query<{ html: string }>('SELECT html FROM signature_downloads WHERE id = $1', [token]);
	if (!result.rows[0]) error(404, 'Signature download not found.');
	await rateLimit(runtime.pool, `signature-download:${token.toLowerCase()}`, 240);
	return new Response(result.rows[0].html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': 'inline; filename="signature.html"',
			'Cache-Control': 'no-store, max-age=0',
			'X-Robots-Tag': 'noindex, nofollow, noarchive',
			'Referrer-Policy': 'no-referrer',
			'Content-Security-Policy': "sandbox; default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
		}
	});
});
