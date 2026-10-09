import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import { composeNewsletter, createItem, createNewsletter, serializeNewsletter } from './newsletters';
import { markPreviewFields, previewFields, previewFieldValue, updatePreviewField } from './preview-fields';
import { renderTemplate } from './server/render';

const template = '<mjml><mj-body><mj-section><mj-column><mj-text>{{newsletter_name}} / {{text:heading}}</mj-text></mj-column></mj-section>{{items}}</mj-body></mjml>';
const snippet = '<mj-section><mj-column><mj-image css-class="photo" src="{{image:image}}" alt="{{text:image_alt}}" /><mj-text>{{text:title}} / {{textarea:body}}</mj-text><mj-button href="{{url:url}}">{{text:button}}</mj-button></mj-column></mj-section>';

function fixture() {
	const newsletter = createNewsletter('Edition name');
	newsletter.fields = { heading: 'Hello & goodbye' };
	newsletter.items = [
		{ ...createItem(), fields: { image: 'https://example.com/image.webp', image_alt: 'A photo', title: 'First <story>', body: 'First line\nSecond line', button: 'Read more', url: 'https://example.com/story' } },
		{ ...createItem(), fields: { title: 'Second story', body: '' } }
	];
	return { newsletter, fields: previewFields(template, snippet, newsletter) };
}

describe('editable preview fields', () => {
	it('labels campaign fields without changing their internal edition identities', () => {
		const { fields } = fixture();
		const field = fields.find((field) => field.itemId === null && field.name === 'heading');
		expect(field?.label).toBe('Campaign / heading');
		expect(field?.id).toMatch(/^newsletter-field-edition-/);
	});

	it('keeps edition and item identities separate and stable across reorders', () => {
		const { newsletter, fields } = fixture();
		const before = fields.map((field) => [field.itemId, field.name, field.id]);
		newsletter.items.reverse();
		const after = previewFields(template, snippet, newsletter);
		for (const [itemId, name, id] of before) expect(after.find((field) => field.itemId === itemId && field.name === name)?.id).toBe(id);
		expect(new Set(fields.map((field) => field.id)).size).toBe(fields.length);
		expect(fields.every((field) => /^[a-z0-9-]+$/.test(field.id))).toBe(true);
	});

	it('updates the same draft data as the form without modifying other items or the original', () => {
		const { newsletter, fields } = fixture();
		const original = serializeNewsletter(newsletter);
		for (const [name, itemId, value] of [
			['heading', null, '<Headline>'],
			['title', newsletter.items[0].id, 'Edited title'],
			['body', newsletter.items[0].id, 'New\nBody'],
			['image_alt', newsletter.items[0].id, 'New alt']
		] as const) {
			const field = fields.find((field) => field.name === name && field.itemId === itemId)!;
			const updated = updatePreviewField(newsletter, field, value);
			expect(previewFieldValue(updated, field)).toBe(value);
			expect(updated.items[1]).toEqual(newsletter.items[1]);
		}
		expect(serializeNewsletter(newsletter)).toBe(original);
	});

	it('stores selected uploaded and external image URLs in the typed image field', () => {
		const { newsletter, fields } = fixture();
		const image = fields.find((field) => field.name === 'image')!;
		const chosen = updatePreviewField(newsletter, image, 'https://example.com/upload.webp');
		expect(chosen.items[0].fields.image).toBe('https://example.com/upload.webp');
		expect(updatePreviewField(chosen, image, 'https://example.com/other.webp').items[0].fields.image).toBe('https://example.com/other.webp');
	});

	it('only decorates visible text and supported MJML attributes, preserving classes and comments', () => {
		const { newsletter, fields } = fixture();
		const source = '<mj-head><mj-title>{{text:heading}}</mj-title><mj-style>.x { content: "{{text:heading}}"; }</mj-style></mj-head><!-- {{text:heading}} --><mj-text title="{{text:heading}}">{{text:heading}}</mj-text>';
		const marked = markPreviewFields(source, fields, null);
		expect(marked).toContain('<mj-title>{{text:heading}}</mj-title>');
		expect(marked).toContain('<!-- {{text:heading}} -->');
		expect(marked.match(/data-newsletter-field=/g)).toHaveLength(1);
		const itemMarked = markPreviewFields(snippet, fields, newsletter.items[0].id);
		expect(itemMarked).toContain('css-class="photo newsletter-field-');
		expect(itemMarked).toContain('src="{{image:image}}"');
		expect(itemMarked).not.toContain('src="<span');
	});

	it('renders mapped text, image and link targets without changing exported HTML or draft JSON', async () => {
		const { newsletter, fields } = fixture();
		const plain = composeNewsletter(template, snippet, newsletter);
		const editable = composeNewsletter(template, snippet, newsletter, fields);
		expect(plain.error).toBeNull();
		expect(editable.error).toBeNull();
		const result = await renderTemplate(editable.source);
		expect(result.errors).toEqual([]);
		const tree = parse(result.html);
		const markers: string[] = [];
		function visit(node: typeof tree | (typeof tree)['childNodes'][number]) {
			if ('attrs' in node) for (const attribute of node.attrs) {
				if (attribute.name === 'data-newsletter-field') markers.push(attribute.value);
				if (attribute.name === 'class') markers.push(...attribute.value.split(' ').filter((value) => value.startsWith('newsletter-field-')));
			}
			if ('childNodes' in node) for (const child of node.childNodes) visit(child);
		}
		visit(tree);
		for (const field of fields.filter((field) => field.name !== 'image_alt' || field.itemId === newsletter.items[0].id)) {
			expect(markers).toContain(field.id);
		}
		expect(result.html).toContain('First &lt;story&gt;');
		expect(result.html).toContain('First line<br');
		expect((await renderTemplate(plain.source)).html).not.toContain('newsletter-field-');
		expect(serializeNewsletter(newsletter)).not.toContain('newsletter-field-');
	});

	it('retains validation errors and exposes absent default image and button fields in the panel', () => {
		const newsletter = createNewsletter('Default layout');
		newsletter.items = [createItem()];
		const fields = previewFields(template, null, newsletter);
		expect(fields.filter((field) => field.itemId === newsletter.items[0].id).map((field) => field.name)).toEqual(['image', 'image_alt', 'title', 'text', 'url', 'button']);
		const image = fields.find((field) => field.name === 'image')!;
		const invalid = updatePreviewField(newsletter, image, 'javascript:alert(1)');
		expect(composeNewsletter(template, null, invalid, fields).error).toContain('http://');
		newsletter.items = [];
		expect(() => updatePreviewField(newsletter, image, 'Gone')).toThrow('no longer exists');
	});

	it('maps raw HTML links and images as well as MJML background images', async () => {
		const { newsletter } = fixture();
		const raw = '<mj-section background-url="{{image:image}}"><mj-column><mj-text><a class="story-link" href="{{url:url}}">{{text:title}}</a><img src="{{image:image}}" alt="{{text:image_alt}}" /></mj-text></mj-column></mj-section>';
		const fields = previewFields(template, raw, newsletter);
		const result = composeNewsletter(template, raw, newsletter, fields);
		expect(result.error).toBeNull();
		expect(result.source).toContain('<a class="story-link newsletter-field-');
		expect(result.source).toMatch(/<img src="[^"]+" alt="[^"]*" class="newsletter-field-/);
		const html = (await renderTemplate(result.source)).html;
		expect(html).toContain('story-link newsletter-field-');
		expect(html).toContain('background="https://example.com/image.webp"');
	});

	it('does not read inherited properties as custom field values', () => {
		const newsletter = createNewsletter('Empty custom values');
		const fields = previewFields('<mj-text>{{text:toString}}</mj-text>{{items}}', null, newsletter);
		expect(previewFieldValue(newsletter, fields[0])).toBe('');
	});

	it('keeps newsletter naming in edition settings rather than exposing an inline field', () => {
		const { fields } = fixture();
		expect(fields.some((field) => field.name === 'newsletter_name')).toBe(false);
	});
});
