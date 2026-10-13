import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import { composeNewsletter, createItem, createNewsletter, serializeNewsletter } from './newsletters';
import { EMPTY_IMAGE_PLACEHOLDER, PREVIEW_ADD_ITEM_CLASS, markPreviewFields, previewFields, previewFieldValue, previewItemClass, updatePreviewField } from './preview-fields';
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
	it('puts the Add item location after all items and before a template footer, without exporting it', async () => {
		const main = template.replace('{{items}}', '{{items}}<mj-section><mj-column><mj-text>Template footer</mj-text></mj-column></mj-section>');
		const { newsletter } = fixture();
		const fields = previewFields(main, snippet, newsletter);
		const rendered = await renderTemplate(composeNewsletter(main, snippet, newsletter, fields, true).source);
		expect(rendered.errors).toEqual([]);
		const location = rendered.html.indexOf(`class="${PREVIEW_ADD_ITEM_CLASS}"`);
		expect(location).toBeGreaterThan(rendered.html.lastIndexOf(previewItemClass(newsletter.items[1].id)));
		expect(location).toBeLessThan(rendered.html.indexOf('Template footer'));
		expect((await renderTemplate(composeNewsletter(main, snippet, newsletter).source)).html).not.toContain(PREVIEW_ADD_ITEM_CLASS);
		expect(composeNewsletter(main, snippet, newsletter, undefined, true).source).not.toContain(PREVIEW_ADD_ITEM_CLASS);
	});

	it('keeps an Add item location for an empty campaign in Dynamic preview', async () => {
		const newsletter = createNewsletter('Empty campaign');
		const rendered = await renderTemplate(composeNewsletter(template, null, newsletter, previewFields(template, null, newsletter), true).source);
		expect(rendered.errors).toEqual([]);
		expect(rendered.html).toContain(`class="${PREVIEW_ADD_ITEM_CLASS}"`);
		expect(composeNewsletter(template, null, newsletter).source).not.toContain(PREVIEW_ADD_ITEM_CLASS);
	});

	it('renders a crossed placeholder and editable image target for an empty default item without changing exports or storage', async () => {
		const newsletter = createNewsletter('Empty image');
		newsletter.items = [createItem()];
		const snapshot = serializeNewsletter(newsletter);
		const fields = previewFields(template, null, newsletter);
		const image = fields.find((field) => field.type === 'image')!;
		const composed = composeNewsletter(template, null, newsletter, fields, true);
		expect(composed.error).toBeNull();
		expect(composed.source).toContain(EMPTY_IMAGE_PLACEHOLDER);
		const rendered = await renderTemplate(composed.source);
		expect(rendered.errors).toEqual([]);
		expect(rendered.html).toContain(`src="${EMPTY_IMAGE_PLACEHOLDER}"`);
		expect(rendered.html).toContain(image.id);
		expect(previewFieldValue(newsletter, image)).toBe('');
		expect(serializeNewsletter(newsletter)).toBe(snapshot);
		const exported = await renderTemplate(composeNewsletter(template, null, newsletter).source);
		expect(exported.html).not.toContain(EMPTY_IMAGE_PLACEHOLDER);
		expect(exported.html).not.toContain('<img');
	});

	it('shows placeholders in Split preview without introducing inline editing markers', async () => {
		const newsletter = createNewsletter('Split preview');
		newsletter.items = [createItem()];
		const rendered = await renderTemplate(composeNewsletter(template, null, newsletter, undefined, true).source);
		expect(rendered.errors).toEqual([]);
		expect(rendered.html).toContain(EMPTY_IMAGE_PLACEHOLDER);
		expect(rendered.html).not.toContain('newsletter-field-');
	});

	it('handles custom campaign/item images, linked images, raw HTML, and background images independently', async () => {
		const main = template.replace('{{items}}', '<mj-section><mj-column><mj-image src="{{image:hero}}" /></mj-column></mj-section>{{items}}');
		const custom = '<mj-section background-url="{{image:background}}"><mj-column><mj-image width="180px" height="90px" src="{{image:photo}}" href="{{url:target}}" /><mj-text><img src="{{image:inline}}" width="120" /></mj-text></mj-column></mj-section>';
		const newsletter = createNewsletter('Custom images');
		newsletter.items = [{ ...createItem(), fields: { target: 'https://example.com/story' } }];
		const fields = previewFields(main, custom, newsletter);
		const composed = composeNewsletter(main, custom, newsletter, fields, true);
		expect(composed.error).toBeNull();
		expect(composed.source.split(EMPTY_IMAGE_PLACEHOLDER)).toHaveLength(5);
		const rendered = await renderTemplate(composed.source);
		expect(rendered.errors).toEqual([]);
		expect(rendered.html).toContain('href="https://example.com/story"');
		expect(rendered.html).toContain(`background="${EMPTY_IMAGE_PLACEHOLDER}"`);
		expect(rendered.html).toContain('width="180"');
		expect(composeNewsletter(main, custom, newsletter).source).not.toContain(EMPTY_IMAGE_PLACEHOLDER);
	});

	it('replaces the placeholder after selecting an image and restores it when clearing the image', () => {
		const newsletter = createNewsletter('Choose an image');
		newsletter.items = [createItem()];
		const fields = previewFields(template, null, newsletter);
		const image = fields.find((field) => field.type === 'image')!;
		const selected = updatePreviewField(newsletter, image, 'https://example.com/chosen.webp');
		const composed = composeNewsletter(template, null, selected, fields, true);
		expect(composed.source).toContain('https://example.com/chosen.webp');
		expect(composed.source).not.toContain(EMPTY_IMAGE_PLACEHOLDER);
		expect(composeNewsletter(template, null, updatePreviewField(selected, image, ''), fields, true).source).toContain(EMPTY_IMAGE_PLACEHOLDER);
		expect(composeNewsletter(template, null, updatePreviewField(selected, image, 'javascript:alert(1)'), fields, true).error).toContain('http://');
	});

	it('keeps both image and destination URL markers on linked images', async () => {
		const { newsletter } = fixture();
		const linked = '<mj-section><mj-column><mj-image src="{{image:image}}" href="{{url:url}}" /></mj-column></mj-section>';
		const fields = previewFields(template, linked, newsletter);
		const html = (await renderTemplate(composeNewsletter(template, linked, newsletter, fields).source)).html;
		const image = fields.find((field) => field.itemId === newsletter.items[0].id && field.type === 'image')!;
		const url = fields.find((field) => field.itemId === newsletter.items[0].id && field.type === 'url')!;
		expect(html).toContain(`${image.id} ${url.id}`);
	});

	it('marks static and multi-section items for controls without adding markers to exports', async () => {
		const { newsletter } = fixture();
		const staticSnippet = '<mj-section><mj-column><mj-text>Static item</mj-text></mj-column></mj-section><mj-section><mj-column><mj-spacer height="10px" /></mj-column></mj-section>';
		const fields = previewFields(template, staticSnippet, newsletter);
		const editable = await renderTemplate(composeNewsletter(template, staticSnippet, newsletter, fields).source);
		expect(editable.errors).toEqual([]);
		for (const item of newsletter.items) expect(editable.html).toContain(previewItemClass(item.id));
		const exported = await renderTemplate(composeNewsletter(template, staticSnippet, newsletter).source);
		expect(exported.html).not.toContain('newsletter-item-');
		expect(serializeNewsletter(newsletter)).not.toContain('newsletter-item-');
	});

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
