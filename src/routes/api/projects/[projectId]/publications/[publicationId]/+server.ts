import { error } from '@sveltejs/kit';
import { api, requireUser, uuid } from '#lib/server/http.js';
import { requireProject } from '#lib/server/workspace.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const id = uuid(event.params.publicationId);
	await requireProject(pool, projectId, user.id);
	const format = event.url.searchParams.get('format');
	if (format !== 'html' && format !== 'mjml') error(400, 'Choose html or mjml.');
	const result = await pool.query<{ html: string; mjml: string }>('SELECT html, mjml FROM newsletter_publications WHERE id = $1 AND project_id = $2', [id, projectId]);
	if (!result.rows[0]) error(404, 'Publication not found.');
	return new Response(result.rows[0][format], {
		headers: {
			'Content-Type': format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
			'Content-Disposition': `attachment; filename="newsletter-${id}.${format}"`,
			'Content-Security-Policy': "default-src 'none'; sandbox"
		}
	});
});
