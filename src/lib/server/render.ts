import mjml2html from 'mjml';
import { MAX_TEMPLATE_BYTES } from '#lib/remote.js';
import { EMPTY_UTM, type UtmSettings } from '../utm';
import { applyUtmLinks, UtmLinkError } from './utm-links';

export interface RenderResult {
	html: string;
	errors: { message: string; line: number; tagName: string }[];
}

export function validateSource(source: unknown): string | null {
	if (typeof source !== 'string' || source.trim() === '') {
		return 'Choose a non-empty MJML template to preview.';
	}
	if (new TextEncoder().encode(source).length > MAX_TEMPLATE_BYTES) {
		return 'The template is too large. The limit is 1 MB.';
	}
	if (/<mj-include(?:\s|\/|>)/i.test(source)) {
		return 'mj-include is not supported yet. Use a self-contained template for this preview.';
	}
	return null;
}

export async function renderTemplate(source: string, utm: UtmSettings = EMPTY_UTM): Promise<RenderResult> {
	const trackedSource = applyUtmLinks(source, utm);
	const invalid = validateSource(trackedSource);
	if (invalid) throw new UtmLinkError(invalid);
	const result = await mjml2html(trackedSource, {
		validationLevel: 'soft',
		ignoreIncludes: true
	});
	return {
		html: applyUtmLinks(result.html, utm),
		errors: result.errors.map(({ formattedMessage, line, tagName }) => ({
			message: formattedMessage,
			line,
			tagName
		}))
	};
}
