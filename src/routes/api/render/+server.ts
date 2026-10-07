import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_TEMPLATE_BYTES } from '#lib/remote.js';
import { renderTemplate, validateSource } from '#lib/server/render.js';
import { requireUser, rateLimit } from '#lib/server/http.js';
import { parseUtm } from '#lib/utm.js';
import { UtmLinkError } from '#lib/server/utm-links.js';

export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const { pool, user } = requireUser(event);
	await rateLimit(pool, `render:${user.id}`, 240);
	// Bound the stream before parsing, including requests without a Content-Length header.
	const reader = request.body?.getReader();
	if (!reader) return json({ message: 'An MJML template is required.' }, { status: 400 });
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_TEMPLATE_BYTES * 6 + 4096) {
			await reader.cancel();
			return json({ message: 'The request is too large.' }, { status: 413 });
		}
		chunks.push(value);
	}
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	let payload: unknown;
	try {
		payload = JSON.parse(new TextDecoder().decode(body));
	} catch {
		return json({ message: 'Send a valid JSON request.' }, { status: 400 });
	}
	const source = payload && typeof payload === 'object' && 'source' in payload
		? payload.source
		: undefined;
	const message = validateSource(source);
	if (message || typeof source !== 'string') {
		return json({ message }, { status: 400 });
	}
	let utm;
	try { utm = parseUtm(payload && typeof payload === 'object' && 'utm' in payload ? payload.utm : undefined); }
	catch (cause) { return json({ message: cause instanceof Error ? cause.message : 'Invalid UTM settings.' }, { status: 400 }); }
	try {
		return json(await renderTemplate(source, utm));
	} catch (error) {
		// MJML throws for documents that cannot be parsed, rather than returning validation errors.
		console.error('MJML rendering failed:', error);
		return json(
			{ message: error instanceof UtmLinkError ? error.message : 'This template could not be rendered. Check that it has an mjml root and mj-body.' },
			{ status: 422 }
		);
	}
};
