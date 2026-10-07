import type { Pool } from 'pg';
import type { ApplicationSettings } from '../application-settings';

export async function readApplicationSettings(pool: Pool): Promise<ApplicationSettings> {
	const result = await pool.query<{ application_name: string; base_color: string; accent_color: string; revision: number }>(
		'SELECT application_name, base_color, accent_color, revision FROM application_settings WHERE singleton = true'
	);
	const row = result.rows[0];
	if (!row) throw new Error('Application settings are missing. Run database migrations.');
	return { applicationName: row.application_name, baseColor: row.base_color, accentColor: row.accent_color, revision: row.revision };
}
