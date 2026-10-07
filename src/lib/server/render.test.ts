import { describe, expect, it } from 'vitest';
import { renderTemplate, validateSource } from './render';
import { MAX_TEMPLATE_BYTES } from '../remote';

describe('template validation', () => {
	it('requires non-empty source', () => {
		for (const source of [undefined, null, {}, '', '   ']) {
			expect(validateSource(source)).toContain('non-empty');
		}
	});

	it('enforces the byte limit, not just the character count', () => {
		expect(validateSource('a'.repeat(MAX_TEMPLATE_BYTES))).toBeNull();
		expect(validateSource('a'.repeat(MAX_TEMPLATE_BYTES + 1))).toContain('too large');
		expect(validateSource('é'.repeat(MAX_TEMPLATE_BYTES))).toContain('too large');
	});

	it('rejects filesystem includes', () => {
		for (const source of ['<mj-include path="/etc/passwd" />', '<MJ-INCLUDE/>']) {
			expect(validateSource(source)).toContain('not supported');
		}
	});
});

describe('MJML rendering', () => {
	it('renders actual responsive email HTML', async () => {
		const result = await renderTemplate('<mjml><mj-body><mj-section><mj-column><mj-text>Hello newsletter</mj-text></mj-column></mj-section></mj-body></mjml>');
		expect(result.html).toContain('Hello newsletter');
		expect(result.html).toContain('@media');
		expect(result.errors).toEqual([]);
	});

	it('exposes validation errors without losing a renderable preview', async () => {
		const result = await renderTemplate('<mjml><mj-body><mj-section><mj-column><mj-text invalid-attribute="true">Hello</mj-text></mj-column></mj-section></mj-body></mjml>');
		expect(result.html).toContain('Hello');
		expect(result.errors[0].message).toContain('invalid-attribute');
	});

	it('rejects an unparseable document', async () => {
		await expect(renderTemplate('not an MJML document')).rejects.toThrow();
	});
});
