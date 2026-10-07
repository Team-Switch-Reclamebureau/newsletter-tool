import { error } from '@sveltejs/kit';
import { composeNewsletter, parseNewsletter, type Newsletter } from '#lib/newsletters.js';
import { UUID_PATTERN } from '#lib/remote.js';
import { api, rateLimit } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { renderTemplate } from '#lib/server/render.js';
import { UtmLinkError } from '#lib/server/utm-links.js';

export const GET = api(async (event) => {
	const match = event.params.filename?.match(/^([a-f0-9-]{36})\.html$/i);
	if (!match || !UUID_PATTERN.test(match[1])) error(404, 'HTML export not found.');
	const runtime = getRuntime();
	if (!runtime) error(503, 'The newsletter workspace is unavailable.');
	const result = await runtime.pool.query<{ content: Newsletter; template: string; item_template: string | null }>(`
		SELECT n.content, p.template, p.item_template FROM newsletters n
		JOIN projects p ON p.id = n.project_id
		WHERE n.public_id = $1 AND n.deleted_at IS NULL`, [match[1]]);
	const row = result.rows[0];
	if (!row) error(404, 'HTML export not found.');
	await rateLimit(runtime.pool, `html-export:${match[1].toLowerCase()}`, 240);
	const newsletter = parseNewsletter(JSON.stringify(row.content));
	const composed = composeNewsletter(row.template, row.item_template, newsletter);
	if (composed.error) error(422, `The saved edition cannot be exported: ${composed.error}`);
	let rendered;
	try { rendered = await renderTemplate(composed.source, newsletter.utm); }
	catch (cause) {
		console.error('Saved newsletter HTML rendering failed:', match[1], cause);
		error(422, cause instanceof UtmLinkError ? cause.message : 'The saved edition cannot be rendered. Fix its template and save again.');
	}
	if (rendered.errors.length) error(422, `Fix the saved MJML validation warnings: ${rendered.errors.map((item) => item.message).join('; ')}`);
	return new Response(rendered.html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, max-age=0',
			'Pragma': 'no-cache',
			'Expires': '0',
			'X-Robots-Tag': 'noindex, nofollow, noarchive',
			'Referrer-Policy': 'no-referrer',
			'Content-Security-Policy': "sandbox; default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline' http: https:; font-src http: https: data:; base-uri 'none'; form-action 'none'"
		}
	});
});
