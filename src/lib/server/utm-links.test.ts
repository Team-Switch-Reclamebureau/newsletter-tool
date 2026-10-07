import { describe, expect, it } from 'vitest';
import { EMPTY_UTM, parseUtm, type UtmSettings } from '../utm';
import { applyUtmLinks } from './utm-links';
import { renderTemplate } from './render';
import { MAX_TEMPLATE_BYTES } from '../remote';

const settings: UtmSettings = { utm_source: 'mail', utm_medium: 'mail', utm_campaign: 'nieuwsbrief', utm_term: 'october_26' };
const query = 'utm_source=mail&amp;utm_medium=mail&amp;utm_campaign=nieuwsbrief&amp;utm_term=october_26';

describe('edition UTM settings', () => {
	it('starts blank, normalizes input, and returns independent settings objects', () => {
		const empty = parseUtm(undefined);
		expect(empty).toEqual(EMPTY_UTM);
		empty.utm_source = 'changed';
		expect(EMPTY_UTM.utm_source).toBe('');
		expect(parseUtm({ utm_source: ' mail ' })).toEqual({ ...EMPTY_UTM, utm_source: 'mail' });
	});

	it('rejects invalid objects, unknown parameters, oversized values and controls', () => {
		for (const invalid of [null, [], 'mail', { utm_source: 1 }, { utm_content: 'unknown' }, { utm_source: 'x'.repeat(201) }, { utm_term: 'bad\nterm' }]) {
			expect(() => parseUtm(invalid)).toThrow();
		}
		expect(parseUtm({ utm_term: 'x'.repeat(200) }).utm_term).toHaveLength(200);
	});
});

describe('UTM hyperlink rewriting', () => {
	it('leaves the entire document unchanged when all settings are blank', () => {
		const source = '<a HREF=\'https://example.test/path?utm_source=existing#anchor\'>Link</a>';
		expect(applyUtmLinks(source, EMPTY_UTM)).toBe(source);
	});

	it('tracks HTML, MJML button, linked-image and typed-field output links', () => {
		const source = '<a href="https://example.test/story">Story</a><mj-button href=\'http://example.test/button\'>Button</mj-button><mj-image href=https://example.test/product src="https://example.test/image.png" />';
		const result = applyUtmLinks(source, settings);
		expect(result).toContain(`href="https://example.test/story?${query}"`);
		expect(result).toContain(`href="http://example.test/button?${query}"`);
		expect(result).toContain(`href="https://example.test/product?${query}"`);
		expect(result).toContain('src="https://example.test/image.png"');
	});

	it('replaces existing UTM values and preserves other parameters, repeats and fragments', () => {
		const result = applyUtmLinks('<a href="https://example.test/story?x=1&amp;x=2&amp;utm_source=old&amp;utm_source=duplicate&amp;utm_content=keep#section">Story</a>', settings);
		const value = result.match(/href="([^"]+)"/)?.[1].replace(/&amp;/g, '&');
		const url = new URL(value ?? '');
		expect(url.searchParams.getAll('x')).toEqual(['1', '2']);
		expect(url.searchParams.getAll('utm_source')).toEqual(['mail']);
		expect(url.searchParams.get('utm_content')).toBe('keep');
		expect(url.hash).toBe('#section');
	});

	it('URL-encodes input and is idempotent', () => {
		const special = { ...settings, utm_campaign: 'flowers & plants', utm_term: 'október #26' };
		const result = applyUtmLinks('<a href="https://example.test/">Story</a>', special);
		const url = new URL(result.match(/href="([^"]+)"/)?.[1].replace(/&amp;/g, '&') ?? '');
		expect(url.searchParams.get('utm_campaign')).toBe(special.utm_campaign);
		expect(url.searchParams.get('utm_term')).toBe(special.utm_term);
		expect(applyUtmLinks(result, special)).toBe(result);
	});

	it('preserves parameters corresponding to blank fields', () => {
		const result = applyUtmLinks('<a href="https://example.test/?utm_term=existing">Story</a>', { ...EMPTY_UTM, utm_source: 'mail' });
		expect(result).toContain('utm_term=existing&amp;utm_source=mail');
		expect(result).not.toContain('utm_medium');
	});

	it('does not track resources, image URLs, email, telephone, relative or anchor links', () => {
		const source = '<img src="https://example.test/photo" /><a href="https://example.test/photo.webp?size=1">Image</a><link href="https://example.test/font.css" /><mj-font href="https://example.test/font" /><a href="mailto:test@example.test">Email</a><a href="tel:123">Call</a><a href="/relative">Relative</a><a href="#anchor">Anchor</a>';
		expect(applyUtmLinks(source, settings)).toBe(source);
	});

	it('preserves normal comments and style text but tracks Outlook conditional links', () => {
		const source = '<!-- <a href="https://example.test/comment">Comment</a> --><mj-style>.test::after { content: \'<a href="https://example.test/style">\'; }</mj-style><!--[if mso]><a href="https://example.test/outlook">Outlook</a><![endif]-->';
		const result = applyUtmLinks(source, settings);
		expect(result).toContain('href="https://example.test/comment"');
		expect(result).toContain('href="https://example.test/style"');
		expect(result).toContain(`href="https://example.test/outlook?${query}"`);
	});

	it('reports malformed HTTP(S) links instead of silently skipping tracking', () => {
		expect(() => applyUtmLinks('<a href="https://%">Bad</a>', settings)).toThrow('invalid HTTP(S) link');
	});

	it('handles reconstructed HTML formatting without rewriting an attribute twice', () => {
		const source = '<p><a href="https://example.test/story">First</p>Second</a>';
		expect(applyUtmLinks(source, settings)).toBe(`<p><a href="https://example.test/story?${query}">First</p>Second</a>`);
	});

	it('enforces the MJML size limit after tracking parameters are added', async () => {
		const content = '<mjml><mj-body><mj-section><mj-column><mj-text><a href="https://example.test/">Go</a>'
			+ 'x'.repeat(MAX_TEMPLATE_BYTES - 200) + '</mj-text></mj-column></mj-section></mj-body></mjml>';
		expect(new TextEncoder().encode(content).length).toBeLessThan(MAX_TEMPLATE_BYTES);
		await expect(renderTemplate(content, { ...settings, utm_campaign: 'x'.repeat(200) })).rejects.toThrow('limit is 1 MB');
	});

	it('tracks rendered MJML output, while leaving newsletter images unchanged', async () => {
		const source = '<mjml><mj-body><mj-section><mj-column><mj-button href="https://example.test/button?existing=1#part">Go</mj-button><mj-text><a href="https://example.test/text">Story</a></mj-text><mj-image src="https://example.test/photo.png" /></mj-column></mj-section></mj-body></mjml>';
		const rendered = await renderTemplate(source, settings);
		expect(rendered.errors).toEqual([]);
		expect(rendered.html).toContain(`href="https://example.test/button?existing=1&amp;${query}#part"`);
		expect(rendered.html).toContain(`href="https://example.test/text?${query}"`);
		expect(rendered.html).toContain('src="https://example.test/photo.png"');
	});
});
