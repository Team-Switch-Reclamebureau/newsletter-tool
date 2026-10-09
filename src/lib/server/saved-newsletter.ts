import { error } from '@sveltejs/kit';
import { composeNewsletter, parseNewsletter, type Newsletter } from '../newsletters';
import { renderTemplate } from './render';
import { UtmLinkError } from './utm-links';

export interface SavedNewsletterSource {
	content: Newsletter;
	template: string;
	item_template: string | null;
}

export async function renderSavedNewsletter(row: SavedNewsletterSource, id: string) {
	let newsletter: Newsletter;
	try { newsletter = parseNewsletter(JSON.stringify(row.content)); }
	catch (cause) {
		console.error('Saved newsletter content validation failed:', id, cause);
		error(422, `The saved campaign cannot be exported: ${cause instanceof Error ? cause.message : 'Invalid newsletter content.'}`);
	}
	const composed = composeNewsletter(row.template, row.item_template, newsletter);
	if (composed.error) error(422, `The saved campaign cannot be exported: ${composed.error}`);
	let rendered;
	try { rendered = await renderTemplate(composed.source, newsletter.utm); }
	catch (cause) {
		console.error('Saved newsletter HTML rendering failed:', id, cause);
		error(422, cause instanceof UtmLinkError ? cause.message : 'The saved campaign cannot be rendered. Fix its template and save again.');
	}
	if (rendered.errors.length) error(422, `Fix the saved MJML validation warnings: ${rendered.errors.map((item) => item.message).join('; ')}`);
	return { newsletter, html: rendered.html };
}
