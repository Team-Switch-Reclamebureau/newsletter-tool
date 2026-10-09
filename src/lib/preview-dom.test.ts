import { describe, expect, it } from 'vitest';
import { previewText } from './preview-dom';

describe('inline preview text', () => {
	it('removes only the browser caret placeholder, not meaningful trailing line breaks', () => {
		const element = { innerText: 'First\nSecond\n' };
		expect(previewText(element)).toBe('First\nSecond');
		element.innerText = 'First\nSecond\n\n';
		expect(previewText(element)).toBe('First\nSecond\n');
		element.innerText = 'First\nSecond\n\n\n';
		expect(previewText(element)).toBe('First\nSecond\n\n');
	});

	it('preserves spaces, literal markup, and empty values', () => {
		const element = { innerText: '  Plain <text> & content  ' };
		expect(previewText(element)).toBe('  Plain <text> & content  ');
		element.innerText = '\n';
		expect(previewText(element)).toBe('');
	});
});
