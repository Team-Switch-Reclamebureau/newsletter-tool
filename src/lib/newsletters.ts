import { MAX_TEMPLATE_BYTES, UUID_PATTERN } from './remote';
import { fieldError, fieldValue, templateFields, validFieldValues, validHttpUrl, type FieldValues } from './template-fields';
import { EMPTY_UTM, parseUtm, type UtmSettings } from './utm';
export { validHttpUrl } from './template-fields';

export interface NewsletterItem {
	fields?: FieldValues;
	id: string;
	image: string;
	imageAssetId?: string;
	imageAlt?: string;
	title: string;
	text: string;
	button: string;
	url: string;
}

export interface Newsletter {
	utm: UtmSettings;
	fields?: FieldValues;
	version: 1;
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	items: NewsletterItem[];
}

export function createNewsletter(name: string): Newsletter {
	const timestamp = new Date().toISOString();
	return {
		version: 1, id: crypto.randomUUID(), name: name.trim(),
		createdAt: timestamp, updatedAt: timestamp, items: [], utm: { ...EMPTY_UTM }
	};
}

export function createItem(): NewsletterItem {
	return { id: crypto.randomUUID(), image: '', title: 'New item', text: '', button: '', url: '' };
}

export function cloneNewsletter(newsletter: Newsletter, name: string): Newsletter {
	return {
		...createNewsletter(name),
		utm: { ...newsletter.utm },
		...(newsletter.fields === undefined ? {} : { fields: { ...newsletter.fields } }),
		items: newsletter.items.map((item) => ({
			...item, id: crypto.randomUUID(),
			...(item.fields === undefined ? {} : { fields: { ...item.fields } })
		}))
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isItem(value: unknown): value is NewsletterItem {
	return record(value) && ['id', 'image', 'title', 'text', 'button', 'url']
		.every((key) => typeof value[key] === 'string') && typeof value.id === 'string' && value.id.length > 0
		&& (value.imageAssetId === undefined || (typeof value.imageAssetId === 'string' && UUID_PATTERN.test(value.imageAssetId)))
		&& (value.imageAlt === undefined || typeof value.imageAlt === 'string')
		&& (value.fields === undefined || validFieldValues(value.fields));
}

export function newsletterError(newsletter: Newsletter): string | null {
	if (!newsletter.name.trim()) return 'Give this newsletter a name.';
	try { parseUtm(newsletter.utm); }
	catch (cause) { return cause instanceof Error ? cause.message : 'Invalid UTM settings.'; }
	for (const [index, item] of newsletter.items.entries()) {
		const prefix = `Item ${index + 1}:`;
		if (item.fields === undefined && !item.title.trim()) return `${prefix} add a title.`;
		if (item.image && !validHttpUrl(item.image)) return `${prefix} use an absolute http:// or https:// image URL.`;
		if (item.url && !validHttpUrl(item.url)) return `${prefix} use an absolute http:// or https:// button URL.`;
		if (Boolean(item.button.trim()) !== Boolean(item.url.trim())) {
			return `${prefix} add both a button label and URL, or leave both empty.`;
		}
	}
	return null;
}

export function serializeNewsletter(newsletter: Newsletter): string {
	return JSON.stringify(newsletter, null, 2) + '\n';
}

export function parseNewsletter(contents: string): Newsletter {
	if (new TextEncoder().encode(contents).length > MAX_TEMPLATE_BYTES) {
		throw new Error('The newsletter file exceeds the 1 MB limit.');
	}
	const value: unknown = JSON.parse(contents);
	if (!record(value) || value.version !== 1 || typeof value.id !== 'string'
		|| !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id)
		|| typeof value.name !== 'string' || typeof value.createdAt !== 'string'
		|| typeof value.updatedAt !== 'string' || !Array.isArray(value.items) || !value.items.every(isItem)
		|| (value.fields !== undefined && !validFieldValues(value.fields))
		|| !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
		throw new Error('Invalid newsletter file. Expected a version 1 newsletter with named items.');
	}
	if (new Set(value.items.map((item) => item.id)).size !== value.items.length) {
		throw new Error('Newsletter item ids must be unique.');
	}
	const newsletter: Newsletter = {
		version: 1, id: value.id, name: value.name, createdAt: value.createdAt,
		updatedAt: value.updatedAt, items: value.items, utm: parseUtm(value.utm),
		...(value.fields === undefined ? {} : { fields: value.fields })
	};
	const message = newsletterError(newsletter);
	if (message) throw new Error(message);
	return newsletter;
}

function escapeMarkup(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character] ?? character);
}

export function defaultItemSnippet(item: NewsletterItem): string {
	return `<mj-section><mj-column>
${item.image ? '<mj-image src="{{image}}" alt="{{image_alt}}" />' : ''}
<mj-text font-size="24px" font-weight="bold">{{title}}</mj-text>
<mj-text>{{text}}</mj-text>
${item.button && item.url ? '<mj-button href="{{url}}">{{button}}</mj-button>' : ''}
</mj-column></mj-section>`;
}

export function templateValuesError(template: string, snippet: string | null, newsletter: Newsletter | null): string | null {
	for (const [scope, source] of [['template', template], ['item', snippet ?? '{{image}}{{image_alt}}{{title}}{{text}}{{button}}{{url}}']] as const) {
		const schema = templateFields(source, scope);
		if (schema.error) return schema.error;
		const entries = scope === 'template' ? [newsletter] : newsletter?.items ?? [];
		for (const [index, entry] of entries.entries()) {
			if (!entry) continue;
			for (const field of schema.fields) {
				if (!field.typed) {
					if (field.name === 'title' && 'title' in entry && !entry.title.trim()) return `Item ${index + 1}: add a title.`;
					continue;
				}
				const message = fieldError(field, fieldValue(entry.fields, field.name));
				if (message) return `${scope === 'item' ? `Item ${index + 1}: ` : ''}${message}`;
			}
		}
	}
	return null;
}

export function composeNewsletter(template: string, snippet: string | null, newsletter: Newsletter | null): { source: string; error: string | null } {
	const fail = (error: string) => ({ source: '', error });
	if (!template) return { source: '', error: null };
	const fieldsError = templateValuesError(template, snippet, newsletter);
	if (fieldsError) return fail(fieldsError);
	if (newsletter) {
		const message = newsletterError(newsletter);
		if (message) return fail(message);
		const activeTemplate = template.replace(/<!--[\s\S]*?-->/g, '');
		const body = activeTemplate.match(/<mj-body\b[^>]*>([\s\S]*?)<\/mj-body\s*>/i)?.[1] ?? '';
		const slots = activeTemplate.match(/{{\s*items\s*}}/g) ?? [];
		if (slots.length !== 1 || (body.match(/{{\s*items\s*}}/g) ?? []).length !== 1) {
			return fail('Add exactly one {{items}} placeholder inside mj-body in the project template to preview this newsletter.');
		}
		if (newsletter.items.length && snippet !== null && !snippet.trim()) return fail('The item snippet is empty. Add an item snippet or leave it unset to use the default layout.');
	}
	let itemMarkup = '';
	for (const item of newsletter?.items ?? []) {
		let unknown = '';
		itemMarkup += (snippet ?? defaultItemSnippet(item)).replace(/<!--[\s\S]*?-->|{{\s*([^{}]*?)\s*}}/g, (match: string, tag: string | undefined) => {
			if (tag === undefined) return match;
			const key = tag.trim();
			if (key.includes(':')) {
				const [type, name] = key.split(':').map((part) => part.trim());
				const value = escapeMarkup(fieldValue(item.fields, name));
				return type === 'textarea' ? value.replace(/\r?\n/g, '<br />') : value;
			}
			switch (key) {
				case 'image': return escapeMarkup(item.image);
				case 'image_alt': return escapeMarkup(item.imageAlt ?? item.title);
				case 'title': return escapeMarkup(item.title);
				case 'text': return escapeMarkup(item.text).replace(/\r?\n/g, '<br />');
				case 'button': return escapeMarkup(item.button);
				case 'url': return escapeMarkup(item.url);
				default: unknown = key; return '';
			}
		}) + '\n';
		if (unknown) return fail(`Unknown item placeholder {{${unknown}}}. Use image, image_alt, title, text, button, or url.`);
	}
	let unknown = '';
	const source = template.replace(/<!--[\s\S]*?-->|{{\s*([^{}]*?)\s*}}/g, (match: string, tag: string | undefined) => {
		if (tag === undefined) return match;
		const key = tag.trim();
		if (key.includes(':')) {
			const [type, name] = key.split(':').map((part) => part.trim());
			const value = escapeMarkup(fieldValue(newsletter?.fields, name));
			return type === 'textarea' ? value.replace(/\r?\n/g, '<br />') : value;
		}
		if (key === 'items') return itemMarkup;
		if (key === 'newsletter_name') return escapeMarkup(newsletter?.name ?? '');
		unknown = key;
		return '';
	});
	if (unknown) return fail(`Unknown template placeholder {{${unknown}}}. Use items or newsletter_name.`);
	if (new TextEncoder().encode(source).length > MAX_TEMPLATE_BYTES) return fail('The assembled MJML exceeds the 1 MB preview limit.');
	return { source, error: null };
}
