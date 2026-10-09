export type EditorLayout = 'split' | 'dynamic';

export interface UserPreferences {
	editorLayout: EditorLayout;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = { editorLayout: 'split' };

export function parseEditorLayout(value: unknown): EditorLayout {
	if (value !== 'split' && value !== 'dynamic') throw new Error('Choose Split or Dynamic as the editor layout.');
	return value;
}
