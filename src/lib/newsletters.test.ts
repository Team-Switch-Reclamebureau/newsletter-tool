import { describe, expect, it } from 'vitest';
import {
	cloneNewsletter, composeNewsletter, createItem, createNewsletter, newsletterError, parseNewsletter,
	serializeNewsletter, type Newsletter
} from './newsletters';
import { MAX_TEMPLATE_BYTES } from './remote';
import { renderTemplate } from './server/render';

const template = '<mjml><mj-body>{{items}}</mj-body></mjml>';

function edition(): Newsletter {
	const newsletter = createNewsletter('October highlights');
	newsletter.items.push({
		...createItem(), image: 'https://example.com/image.jpg', title: 'Our latest story',
		text: 'First line\nSecond line', button: 'Read more', url: 'https://example.com/story?a=1&b=2'
	});
	return newsletter;
}

describe('newsletter data', () => {
	it('creates independent editions with unique ids and item arrays', () => {
		const first = createNewsletter(' First ');
		const second = createNewsletter('Second');
		first.items.push(createItem());
		expect(first.id).not.toBe(second.id);
		expect(first.name).toBe('First');
		expect(second.items).toEqual([]);
	});

	it('round-trips all item fields and metadata', () => {
		const newsletter = edition();
		expect(parseNewsletter(serializeNewsletter(newsletter))).toEqual(newsletter);
	});

	it('clones legacy editions with new identities and timestamps while preserving content and images', () => {
		const original = edition();
		original.createdAt = original.updatedAt = '2020-01-01T00:00:00.000Z';
		original.items[0].imageAssetId = crypto.randomUUID();
		original.items[0].imageAlt = 'Story photo';
		const snapshot = serializeNewsletter(original);
		const clone = cloneNewsletter(original, '  November variation  ');
		expect(clone.name).toBe('November variation');
		expect(clone.id).not.toBe(original.id);
		expect(clone.createdAt).not.toBe(original.createdAt);
		expect(clone.updatedAt).toBe(clone.createdAt);
		expect(clone.items[0].id).not.toBe(original.items[0].id);
		expect(clone.items[0]).toEqual({ ...original.items[0], id: clone.items[0].id });
		expect(parseNewsletter(serializeNewsletter(clone))).toEqual(clone);
		clone.items[0].title = 'Changed only in clone';
		clone.items.push(createItem());
		expect(serializeNewsletter(original)).toBe(snapshot);
	});

	it('copies custom field maps independently and preserves item order', () => {
		const original = edition();
		original.fields = { headline: 'Original headline', hero: 'https://example.com/hero.webp' };
		original.items[0].fields = { heading: 'First story', photo: 'https://example.com/photo.webp' };
		original.items.push({ ...createItem(), fields: { heading: 'Second story' } });
		const clone = cloneNewsletter(original, 'Variation');
		expect(clone.fields).toEqual(original.fields);
		expect(clone.items.map((item) => item.fields)).toEqual(original.items.map((item) => item.fields));
		expect(new Set([...original.items, ...clone.items].map((item) => item.id)).size).toBe(4);
		clone.fields!.headline = 'Changed headline';
		clone.items[0].fields!.heading = 'Changed story';
		expect(original.fields.headline).toBe('Original headline');
		expect(original.items[0].fields.heading).toBe('First story');
	});

	it('clones an empty edition without introducing custom fields', () => {
		const clone = cloneNewsletter(createNewsletter('Empty'), 'Empty copy');
		expect(clone.items).toEqual([]);
		expect(clone.fields).toBeUndefined();
		expect(parseNewsletter(serializeNewsletter(clone))).toEqual(clone);
	});

	it('rejects corrupt JSON, unsupported versions, and unsafe ids', () => {
		expect(() => parseNewsletter('{')).toThrow();
		for (const changes of [{ version: 2 }, { id: '../escape' }, { items: [{}] }, { updatedAt: 'invalid' }]) {
			expect(() => parseNewsletter(JSON.stringify({ ...edition(), ...changes }))).toThrow('Invalid newsletter');
		}
	});

	it('rejects duplicate item ids', () => {
		const newsletter = edition();
		newsletter.items.push({ ...newsletter.items[0] });
		expect(() => parseNewsletter(serializeNewsletter(newsletter))).toThrow('unique');
	});

	it('rejects newsletter JSON over the byte limit', () => {
		const newsletter = edition();
		newsletter.items[0].text = 'x'.repeat(MAX_TEMPLATE_BYTES);
		expect(() => parseNewsletter(serializeNewsletter(newsletter))).toThrow('1 MB');
	});

	it('validates titles, button pairs, and safe absolute URLs', () => {
		const newsletter = edition();
		newsletter.items[0].url = 'javascript:alert(1)';
		expect(newsletterError(newsletter)).toContain('http://');
		newsletter.items[0].url = '';
		expect(newsletterError(newsletter)).toContain('both');
		newsletter.items[0].button = '';
		newsletter.items[0].image = '/local.png';
		expect(newsletterError(newsletter)).toContain('image URL');
		newsletter.items[0].image = '';
		newsletter.items[0].title = ' ';
		expect(newsletterError(newsletter)).toContain('title');
	});
});

describe('newsletter assembly', () => {
	it('round-trips dynamic fields, including unused values, without requiring a legacy title', () => {
		const newsletter = edition();
		newsletter.fields = { headline: 'Edition headline', removed: 'Keep me' };
		newsletter.items[0].fields = { heading: 'Item heading', price: '12.5' };
		newsletter.items[0].title = '';
		expect(parseNewsletter(serializeNewsletter(newsletter))).toEqual(newsletter);
	});

	it('rejects malformed dynamic field maps at both scopes', () => {
		for (const fields of [[], null, { value: 42 }, { constructor: 'unsafe' }]) {
			const newsletter = edition();
			expect(() => parseNewsletter(JSON.stringify({ ...newsletter, fields }))).toThrow('Invalid newsletter');
			expect(() => parseNewsletter(JSON.stringify({ ...newsletter, items: [{ ...newsletter.items[0], fields }] }))).toThrow('Invalid newsletter');
		}
	});

	it('renders independent newsletter and item values with escaping and multiline text', async () => {
		const newsletter = edition();
		newsletter.fields = { heading: 'Global & {{text:heading}}', introduction: 'Hello\nReaders' };
		newsletter.items[0].fields = { heading: '<Story>', description: 'Line 1\nLine 2', destination: 'https://example.com/?a=1&b=2', price: '12.5' };
		newsletter.items.push({ ...createItem(), fields: { heading: 'Second story' } });
		const main = '<mjml><mj-body><mj-section><mj-column><mj-text>{{text:heading}} {{textarea:introduction}}</mj-text></mj-column></mj-section>{{items}}</mj-body></mjml>';
		const snippet = '<mj-section><mj-column><mj-text>{{text:heading}} {{textarea:description}} {{number:price}}</mj-text><mj-button href="{{url:destination}}">{{title}}</mj-button></mj-column></mj-section>';
		const result = composeNewsletter(main, snippet, newsletter);
		expect(result.error).toBeNull();
		expect(result.source).toContain('Global &amp; {{text:heading}}');
		expect(result.source).toContain('Hello<br />Readers');
		expect(result.source).toContain('&lt;Story&gt; Line 1<br />Line 2 12.5');
		expect(result.source).toContain('https://example.com/?a=1&amp;b=2');
		expect(result.source).toContain('Second story');
		expect(result.source).toContain('Our latest story');
		expect((await renderTemplate(result.source)).errors).toEqual([]);
	});

	it('validates typed values before interpolation and clears typed tags in template-only preview', () => {
		const newsletter = edition();
		newsletter.fields = { destination: 'javascript:alert(1)' };
		const main = template.replace('{{items}}', '{{url:destination}}{{items}}');
		expect(composeNewsletter(main, null, newsletter).error).toContain('destination');
		newsletter.fields.destination = '';
		newsletter.items[0].fields = { price: 'Infinity' };
		expect(composeNewsletter(main, '{{number:price}}', newsletter).error).toContain('Item 1');
		expect(composeNewsletter(main, '{{number:price}}', null).source).toBe('<mjml><mj-body></mj-body></mjml>');
		expect(composeNewsletter(template, '{{text:heading}}{{number:heading}}', newsletter).error).toContain('conflicting');
	});

	it('preserves commented tags without generating fields or treating them as errors', () => {
		const main = template.replace('{{items}}', '<!-- {{unsupported}} -->{{items}}');
		expect(composeNewsletter(main, '<!-- {{bad:type}} -->{{title}}', edition()).error).toBeNull();
	});

	it('repeats the custom snippet in item order and fills every field', async () => {
		const newsletter = edition();
		newsletter.items.push({ ...createItem(), title: 'Another story', text: 'Another text' });
		const snippet = '<mj-section><mj-column><mj-image src="{{image}}" /><mj-text>{{title}}</mj-text><mj-text>{{text}}</mj-text><mj-button href="{{url}}">{{button}}</mj-button></mj-column></mj-section>';
		const result = composeNewsletter(template, snippet, newsletter);
		expect(result.error).toBeNull();
		expect(result.source).toContain('src="https://example.com/image.jpg"');
		expect(result.source).toContain('First line<br />Second line');
		expect(result.source).toContain('href="https://example.com/story?a=1&amp;b=2"');
		expect(result.source.indexOf('Our latest story')).toBeLessThan(result.source.indexOf('Another story'));
		expect((await renderTemplate(result.source)).html).toContain('Read more');
	});

	it('uses the default snippet when missing and renders real MJML without warnings', async () => {
		const newsletter = edition();
		const result = composeNewsletter(template, null, newsletter);
		expect(result.error).toBeNull();
		const rendered = await renderTemplate(result.source);
		expect(rendered.html).toContain('Our latest story');
		expect(rendered.errors).toEqual([]);
	});

	it('omits optional images and buttons in the default layout', () => {
		const newsletter = createNewsletter('Plain newsletter');
		newsletter.items.push(createItem());
		const result = composeNewsletter(template, null, newsletter);
		expect(result.source).not.toContain('<mj-image');
		expect(result.source).not.toContain('<mj-button');
	});

	it('escapes content and does not recursively interpret user placeholders', () => {
		const newsletter = edition();
		newsletter.items[0].title = '<mj-raw>Injected</mj-raw> "{{items}}" &';
		const result = composeNewsletter(template, null, newsletter);
		expect(result.source).toContain('&lt;mj-raw&gt;Injected&lt;/mj-raw&gt;');
		expect(result.source).toContain('&quot;{{items}}&quot; &amp;');
		expect(result.source).not.toContain('<mj-raw>');
	});

	it('clears placeholders for template preview and supports newsletter names', () => {
		expect(composeNewsletter(template, null, null)).toEqual({ source: '<mjml><mj-body></mj-body></mjml>', error: null });
		const newsletter = createNewsletter('News & notes');
		expect(composeNewsletter('<mjml><mj-body>{{newsletter_name}} {{items}}</mj-body></mjml>', null, newsletter).source).toBe('<mjml><mj-body>News &amp; notes </mj-body></mjml>');
	});

	it('surfaces missing, repeated, unknown, and empty snippet placeholders', () => {
		expect(composeNewsletter('<mjml />', null, edition()).error).toContain('{{items}}');
		expect(composeNewsletter('{{items}}{{items}}', null, edition()).error).toContain('exactly one');
		expect(composeNewsletter(template, '{{unsupported}}', edition()).error).toContain('Unknown item');
		expect(composeNewsletter(template.replace('{{items}}', '{{other}}{{items}}'), null, edition()).error).toContain('Unknown template');
		expect(composeNewsletter(template, '', edition()).error).toContain('empty');
	});

	it('rejects slots in comments or outside the email body', () => {
		expect(composeNewsletter('<mjml><mj-head>{{items}}</mj-head><mj-body></mj-body></mjml>', null, edition()).error).toContain('inside mj-body');
		expect(composeNewsletter('<mjml><mj-body><!-- {{items}} --></mj-body></mjml>', null, edition()).error).toContain('inside mj-body');
	});

	it('enforces the assembled byte limit after escaping item content', () => {
		const newsletter = edition();
		newsletter.items[0].text = '&'.repeat(Math.floor(MAX_TEMPLATE_BYTES / 4));
		expect(composeNewsletter(template, null, newsletter).error).toContain('1 MB');
	});
});
