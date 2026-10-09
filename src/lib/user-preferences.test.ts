import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PREFERENCES, parseEditorLayout } from './user-preferences';

describe('user editor preferences', () => {
	it('defaults new users to Split and accepts both supported layouts', () => {
		expect(DEFAULT_USER_PREFERENCES).toEqual({ editorLayout: 'split' });
		expect(parseEditorLayout('split')).toBe('split');
		expect(parseEditorLayout('dynamic')).toBe('dynamic');
	});

	it('rejects missing, malformed, and unsupported layouts', () => {
		for (const value of [undefined, null, '', 'Dynamic', 'preview', {}, [], 1]) {
			expect(() => parseEditorLayout(value)).toThrow('Choose Split or Dynamic');
		}
	});
});
