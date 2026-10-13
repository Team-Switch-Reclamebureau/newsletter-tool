import { describe, expect, it } from 'vitest';
import { previewText, previewViewportHeight } from './preview-dom';

describe('dynamic preview height', () => {
	it('fills the available window below the campaign controls with a bottom gap', () => {
		expect(previewViewportHeight(1000, 240)).toBe(744);
		expect(previewViewportHeight(1400, 180)).toBe(1204);
		expect(previewViewportHeight(800, 180.5)).toBe(603);
	});

	it('keeps a usable editor when the window is too short to fit the page controls', () => {
		expect(previewViewportHeight(500, 300)).toBe(320);
	});
});

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
