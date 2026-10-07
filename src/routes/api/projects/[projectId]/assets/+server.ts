import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { api, readBody, requireUser, uuid, rateLimit } from '#lib/server/http.js';
import { listAssets, listEditionAssets, requireNewsletter, requireProject, transaction } from '#lib/server/workspace.js';
import { ImageValidationError, processImage } from '#lib/server/storage.js';
import { MAX_IMAGE_BYTES, imageAssetUrl } from '#lib/remote.js';

export const GET = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	await requireProject(pool, projectId, user.id);
	const selected = event.url.searchParams.get('newsletterId');
	const newsletterId = selected === null ? undefined : uuid(selected);
	if (newsletterId) await requireNewsletter(pool, projectId, newsletterId);
	const assets = await listAssets(pool, projectId, config.origin, newsletterId);
	return json({
		assets,
		...(event.url.searchParams.get('includeEditions') === 'true'
			? { editionAssets: await listEditionAssets(pool, projectId, config.origin) } : {})
	});
});

export const POST = api(async (event) => {
	const { pool, user, storage, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	await requireProject(pool, projectId, user.id);
	const selected = event.url.searchParams.get('newsletterId');
	const newsletterId = selected === null ? undefined : uuid(selected);
	if (newsletterId) await requireNewsletter(pool, projectId, newsletterId);
	const scope = newsletterId ? 'edition' : 'project';
	await rateLimit(pool, `upload:${user.id}`, 30);
	if (!event.request.headers.get('content-type')?.startsWith('multipart/form-data;')) error(415, 'Send a multipart image upload.');
	const body = await readBody(event.request, MAX_IMAGE_BYTES + 1024 * 1024);
	let form: FormData;
	try {
		form = await new Request(event.request.url, { method: 'POST', headers: event.request.headers, body: body.buffer }).formData();
	} catch { error(400, 'The image upload could not be read.'); }
	const file = form.get('image');
	if (!(file instanceof File)) error(400, 'Choose an image to upload.');
	let image;
	try { image = await processImage(new Uint8Array(await file.arrayBuffer()), file.type); }
	catch (cause) {
		if (cause instanceof ImageValidationError) error(400, cause.message);
		throw cause;
	}
	const id = randomUUID();
	const filename = basename(file.name).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'image';
	await storage.put(id, image.data);
	try {
		await transaction(pool, async (client) => {
			await requireProject(client, projectId, user.id, true);
			if (newsletterId) await requireNewsletter(client, projectId, newsletterId);
			await client.query('INSERT INTO image_assets(id, project_id, original_name, width, height, bytes, created_by, scope) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, projectId, filename, image.width, image.height, image.data.byteLength, user.id, scope]);
			if (newsletterId) await client.query('INSERT INTO newsletter_images(project_id, newsletter_id, image_asset_id) VALUES ($1, $2, $3)', [projectId, newsletterId, id]);
		});
	} catch (cause) {
		try { await storage.removeUncommitted(id); } catch (cleanupError) { console.error('Could not remove an uncommitted image:', cleanupError); }
		throw cause;
	}
	return json({
		asset: { id, projectId, scope, filename, url: imageAssetUrl(config.origin, id), width: image.width, height: image.height, bytes: image.data.byteLength, createdAt: new Date().toISOString() }
	}, { status: 201 });
});
