import { describe, expect, it } from 'vitest';
import { brandingError, DEFAULT_APPLICATION_SETTINGS, interfaceTheme } from './application-settings';

describe('application branding', () => {
	it('accepts valid names and six-digit colors', () => {
		expect(brandingError(' Newsletter Studio ', '#ABC123', '#2457ab')).toBeNull();
		expect(brandingError('A'.repeat(80), '#000000', '#ffffff')).toBeNull();
	});

	it('rejects missing, oversized and control-character names', () => {
		for (const name of [undefined, 12, '', '  ', 'A'.repeat(81), 'Studio\nName', 'Studio\u0000']) {
			expect(brandingError(name, '#425f30', '#2457ab')).not.toBeNull();
		}
	});

	it('rejects invalid colors and CSS injection', () => {
		for (const color of [undefined, 12, '#fff', 'red', '#000000;', '#gggggg', '#000000;background:red']) {
			expect(brandingError('Studio', color, '#2457ab')).not.toBeNull();
			expect(brandingError('Studio', '#2457ab', color)).not.toBeNull();
			expect(() => interfaceTheme(String(color), '#2457ab')).toThrow('Invalid interface color.');
			expect(() => interfaceTheme('#2457ab', String(color))).toThrow('Invalid interface color.');
		}
	});

	it('uses the saved primary color and resets supporting default palette variables', () => {
		const theme = interfaceTheme(DEFAULT_APPLICATION_SETTINGS.baseColor.toUpperCase(), '#abcdef');
		expect(theme).toContain('--ui-primary:#abcdef');
		expect(theme).toContain('--ui-accent:#abcdef');
		expect(theme).toContain('--ui-bg:initial');
		expect(theme).toContain('--ui-border:initial');
	});

	it('generates the shared palette for a custom interface color', () => {
		const theme = interfaceTheme('#2457ab', '#aa2244');
		expect(theme).toContain('--ui-primary:#aa2244');
		expect(theme).toContain('--ui-accent:#aa2244');
		expect(theme).toContain('--ui-soft:color-mix(in srgb, #2457ab');
		expect(theme).toContain('--ui-soft:color-mix');
		expect(theme).toContain('--ui-border:color-mix');
		expect(theme).toContain('--ui-on-primary:#ffffff');
	});

	it('keeps primary-button text at a minimum 4.5:1 contrast across the grayscale range', () => {
		for (let value = 0; value <= 255; value++) {
			const color = `#${value.toString(16).padStart(2, '0').repeat(3)}`;
			const channel = value / 255;
			const luminance = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			const darkText = interfaceTheme('#2457ab', color).includes('--ui-on-primary:#000000');
			const contrast = darkText ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
			expect(contrast, color).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('changes the base palette independently of the button and logo accent', () => {
		const first = interfaceTheme('#2457ab', '#ffcc00').split(';');
		const second = interfaceTheme('#aa2244', '#ffcc00').split(';');
		expect(first.slice(0, 3)).toEqual(second.slice(0, 3));
		expect(first.slice(3)).not.toEqual(second.slice(3));
		const third = interfaceTheme('#2457ab', '#aa2244').split(';');
		expect(first.slice(3)).toEqual(third.slice(3));
		expect(first.slice(0, 3)).not.toEqual(third.slice(0, 3));
	});
});
