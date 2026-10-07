import { error, json } from '@sveltejs/kit';
import { brandingError } from '#lib/application-settings.js';
import { readApplicationSettings } from '#lib/server/application-settings.js';
import { api, readJson, requireAdmin, revision } from '#lib/server/http.js';

export const GET = api(async (event) => {
	const { pool } = requireAdmin(event);
	return json({ settings: await readApplicationSettings(pool) });
});

export const PATCH = api(async (event) => {
	const { pool } = requireAdmin(event);
	const body = await readJson(event.request);
	const invalid = brandingError(body.applicationName, body.baseColor, body.accentColor);
	if (invalid) error(400, invalid);
	if (typeof body.applicationName !== 'string' || typeof body.baseColor !== 'string' || typeof body.accentColor !== 'string') error(400, 'Send an application name, base color, and accent color.');
	const expected = revision(body.revision);
	const result = await pool.query<{ revision: number }>(
		'UPDATE application_settings SET application_name = $1, base_color = $2, accent_color = $3, revision = revision + 1 WHERE singleton = true AND revision = $4 RETURNING revision',
		[body.applicationName.trim(), body.baseColor.toLowerCase(), body.accentColor.toLowerCase(), expected]
	);
	if (!result.rowCount) error(409, 'Settings changed elsewhere. Reload before saving.');
	return json({ settings: { applicationName: body.applicationName.trim(), baseColor: body.baseColor.toLowerCase(), accentColor: body.accentColor.toLowerCase(), revision: result.rows[0].revision } });
});
