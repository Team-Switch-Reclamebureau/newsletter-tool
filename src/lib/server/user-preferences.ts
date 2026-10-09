import type { Pool } from 'pg';
import { DEFAULT_USER_PREFERENCES, parseEditorLayout, type EditorLayout, type UserPreferences } from '../user-preferences';

export async function getUserPreferences(pool: Pool, userId: string): Promise<UserPreferences> {
	const result = await pool.query<{ editor_layout: string }>('SELECT editor_layout FROM user_preferences WHERE user_id = $1', [userId]);
	return result.rows[0] ? { editorLayout: parseEditorLayout(result.rows[0].editor_layout) } : { ...DEFAULT_USER_PREFERENCES };
}

export async function saveEditorLayout(pool: Pool, userId: string, editorLayout: EditorLayout): Promise<UserPreferences> {
	await pool.query(`
		INSERT INTO user_preferences(user_id, editor_layout) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET editor_layout = EXCLUDED.editor_layout`, [userId, editorLayout]);
	return { editorLayout };
}
