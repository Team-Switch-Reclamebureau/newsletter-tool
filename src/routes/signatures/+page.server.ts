import { error, redirect } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import { listProjects } from '#lib/server/workspace.js';
import { listSignatures, requireSignature, signatureDetail } from '#lib/server/signatures.js';
import { uuid } from '#lib/server/http.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const runtime = getRuntime();
	if (!runtime) error(503, 'Configure the hosted workspace first.');
	const [projects, signatures] = await Promise.all([
		listProjects(runtime.pool, locals.user.id),
		listSignatures(runtime.pool)
	]);
	const id = url.searchParams.get('signature');
	const selected = id ? await signatureDetail(runtime.pool, await requireSignature(runtime.pool, uuid(id), locals.user.id)) : null;
	return { user: locals.user, projects, signatures, selected, creating: url.searchParams.get('new') === '1' };
};
