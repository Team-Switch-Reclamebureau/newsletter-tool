import { error } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import { UUID_PATTERN } from '#lib/remote.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const id = params.filename.endsWith('.webp') ? params.filename.slice(0, -5) : '';
	if (!UUID_PATTERN.test(id)) error(404, 'Image not found.');
	const runtime = getRuntime();
	if (!runtime) error(503, 'Image hosting is not configured.');
	try {
		const image = await runtime.storage.read(id);
		return new Response(new Uint8Array(image).buffer, {
			headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }
		});
	} catch (cause) {
		if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') error(404, 'Image not found.');
		console.error('Image delivery failed:', cause);
		error(500, 'The image could not be loaded.');
	}
};
