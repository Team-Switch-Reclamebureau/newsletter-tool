import { error, json } from '@sveltejs/kit';
import { api, readJson, requireUser } from '#lib/server/http.js';
import { getUserPreferences, saveEditorLayout } from '#lib/server/user-preferences.js';
import { parseEditorLayout, type EditorLayout } from '#lib/user-preferences.js';

export const GET = api(async (event) => {
	const { pool, user } = requireUser(event);
	return json({ preferences: await getUserPreferences(pool, user.id) });
});

export const PATCH = api(async (event) => {
	const { pool, user } = requireUser(event);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => key !== 'editorLayout')) error(400, 'Only editorLayout can be updated.');
	let layout: EditorLayout;
	try { layout = parseEditorLayout(body.editorLayout); }
	catch (cause) { error(400, cause instanceof Error ? cause.message : 'Invalid editor layout.'); }
	return json({ preferences: await saveEditorLayout(pool, user.id, layout) });
});
