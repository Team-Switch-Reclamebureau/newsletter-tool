import { describe, expect, it } from 'vitest';
import { cloneNewsletter, composeNewsletter, createItem, createNewsletter, parseNewsletter, serializeNewsletter } from './newsletters';
import { EMPTY_UTM } from './utm';
import { encodeRichText } from './rich-text';
import { renderTemplate } from './server/render';
import { renderSavedNewsletter } from './server/saved-newsletter';
import { parse } from 'parse5';

describe('edition UTM persistence', () => {
	it('tracks formatted campaign and item links in previews and saved exports without mutating their stored URLs', async () => {
		const newsletter = createNewsletter('Formatted links');
		newsletter.utm = { utm_source: 'mail', utm_medium: 'newsletter', utm_campaign: 'Flowers & plants', utm_term: 'October #26' };
		const href = 'https://example.test/story?existing=1&existing=2&utm_source=old&utm_content=keep#section';
		const email = 'mailto:team@example.test?subject=Hello%20there';
		const telephone = 'tel:+31201234567';
		const value = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: 'Read more', marks: [{ type: 'bold' }, { type: 'link', attrs: { href } }] },
			{ type: 'text', text: 'Email', marks: [{ type: 'link', attrs: { href: email } }] },
			{ type: 'text', text: 'Call', marks: [{ type: 'link', attrs: { href: telephone } }] }
		] }] });
		newsletter.fields = { introduction: value };
		newsletter.items = [{ ...createItem(), fields: { body: value } }];
		const template = '<mjml><mj-body><mj-section><mj-column><mj-text>{{textarea:introduction}}</mj-text></mj-column></mj-section>{{items}}</mj-body></mjml>';
		const snippet = '<mj-section><mj-column><mj-text>{{textarea:body}}</mj-text></mj-column></mj-section>';
		const snapshot = serializeNewsletter(newsletter);
		const composed = composeNewsletter(template, snippet, parseNewsletter(snapshot));
		expect(composed.error).toBeNull();
		const preview = await renderTemplate(composed.source, newsletter.utm);
		expect(preview.errors).toEqual([]);
		const saved = await renderSavedNewsletter({ content: newsletter, template, item_template: snippet }, newsletter.id);
		expect(saved.html).toBe(preview.html);
		const tree = parse(saved.html);
		const links: string[] = [];
		function visit(node: typeof tree | (typeof tree)['childNodes'][number]) {
			if ('attrs' in node && node.tagName === 'a') {
				const href = node.attrs.find((attribute) => attribute.name === 'href');
				if (href) links.push(href.value);
			}
			if ('childNodes' in node) for (const child of node.childNodes) visit(child);
		}
		visit(tree);
		expect(links).toHaveLength(6);
		expect(links.filter((href) => href === email)).toHaveLength(2);
		expect(links.filter((href) => href === telephone)).toHaveLength(2);
		for (const value of links.filter((href) => href.startsWith('https://'))) {
			const url = new URL(value);
			expect(url.searchParams.getAll('existing')).toEqual(['1', '2']);
			expect(url.searchParams.getAll('utm_source')).toEqual(['mail']);
			expect(url.searchParams.get('utm_medium')).toBe('newsletter');
			expect(url.searchParams.get('utm_campaign')).toBe('Flowers & plants');
			expect(url.searchParams.get('utm_term')).toBe('October #26');
			expect(url.searchParams.get('utm_content')).toBe('keep');
			expect(url.hash).toBe('#section');
		}
		expect(serializeNewsletter(newsletter)).toBe(snapshot);
		expect((await renderTemplate(composed.source, EMPTY_UTM)).html).toContain('utm_source=old');
	});

	it('imports older edition JSON with blank UTM settings', () => {
		const newsletter = createNewsletter('Legacy edition');
		const legacy = JSON.stringify({ ...newsletter, utm: undefined });
		expect(parseNewsletter(legacy).utm).toEqual(EMPTY_UTM);
	});

	it('round-trips settings through edition JSON and clones them independently', () => {
		const newsletter = createNewsletter('Original edition');
		newsletter.utm = { utm_source: 'mail', utm_medium: 'mail', utm_campaign: 'nieuwsbrief', utm_term: 'october_26' };
		const imported = parseNewsletter(serializeNewsletter(newsletter));
		expect(imported.utm).toEqual(newsletter.utm);
		const clone = cloneNewsletter(imported, 'November edition');
		expect(clone.utm).toEqual(imported.utm);
		clone.utm.utm_term = 'november_26';
		expect(imported.utm.utm_term).toBe('october_26');
		expect(newsletter.utm.utm_term).toBe('october_26');
	});

	it('rejects invalid UTM settings in edition JSON', () => {
		const newsletter = createNewsletter('Invalid edition');
		for (const utm of [null, [], { utm_source: 1 }, { utm_term: 'x'.repeat(201) }]) {
			expect(() => parseNewsletter(JSON.stringify({ ...newsletter, utm }))).toThrow();
		}
	});
});
