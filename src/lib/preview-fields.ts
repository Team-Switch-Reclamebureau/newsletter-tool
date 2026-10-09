import type { Newsletter } from './newsletters';
import { fieldValue, templateFields, type TemplateField } from './template-fields';
import { DEFAULT_ITEM_SNIPPET } from './remote';

export interface PreviewField extends TemplateField {
	id: string;
	itemId: string | null;
	label: string;
	tag: string;
}

function fieldId(itemId: string | null, name: string): string {
	const encode = (value: string) => Array.from(value, (character) => character.codePointAt(0)!.toString(16)).join('-');
	return `newsletter-field-${itemId === null ? 'edition' : encode(itemId)}-${encode(name)}`;
}

export function previewFields(template: string, snippet: string | null, newsletter: Newsletter): PreviewField[] {
	const fields: PreviewField[] = [];
	function add(source: string, itemId: string | null, label: string) {
		const schema = templateFields(source, itemId === null ? 'template' : 'item');
		for (const field of schema.fields) {
			fields.push({
				...field, id: fieldId(itemId, field.name), itemId,
				label: `${label} / ${field.name.replace(/[_-]/g, ' ')}`,
				tag: `${field.type}:${field.name}`
			});
		}
	}
	add(template, null, 'Campaign');
	for (const [index, item] of newsletter.items.entries()) {
		add(snippet ?? DEFAULT_ITEM_SNIPPET, item.id, `Item ${index + 1}`);
	}
	return fields;
}

export function markPreviewFields(source: string, fields: PreviewField[], itemId: string | null): string {
	const available = fields.filter((field) => field.itemId === itemId);
	const find = (tag: string) => available.find((field) => field.tag === tag.split(':').map((part) => part.trim()).join(':'));
	let inHead = false;
	let raw = '';
	return source.replace(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|{{\s*([^{}]*?)\s*}}/g, (token: string, tag: string | undefined) => {
		if (token.startsWith('<!--')) return token;
		if (/^<mj-head\b/i.test(token)) inHead = true;
		if (/^<\/mj-head\b/i.test(token)) inHead = false;
		if (/^<(mj-style|mj-title|mj-preview|script|style)\b/i.test(token)) raw = token.match(/^<([\w-]+)/)?.[1].toLowerCase() ?? '';
		if (raw && token.toLowerCase().startsWith(`</${raw}`)) raw = '';
		if (inHead || raw) return token;
		if (tag !== undefined) {
			const field = find(tag.trim());
			if (!field || field.type === 'url' || field.type === 'image') return token;
			return `<span data-newsletter-field="${field.id}">${token}</span>`;
		}
		if (!/^<(?:mj-(?:image|button|text|section|wrapper|column)|a|img)\b/i.test(token)) return token;
		const ids = [...token.matchAll(/{{\s*([^{}]*?)\s*}}/g)]
			.map((match) => find(match[1].trim())?.id).filter((id): id is string => Boolean(id));
		if (!ids.length) return token;
		const classes = [...new Set(ids)].join(' ');
		const attribute = /^<mj-/i.test(token) ? 'css-class' : 'class';
		if (new RegExp(`\\b${attribute}\\s*=`, 'i').test(token)) {
			return token.replace(new RegExp(`(\\b${attribute}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'i'), (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${value} ${classes}${quote}`);
		}
		return token.replace(/\s*\/?>$/, (ending) => ` ${attribute}="${classes}"${ending}`);
	});
}

export function previewFieldValue(newsletter: Newsletter, field: PreviewField): string {
	if (field.itemId === null) return fieldValue(newsletter.fields, field.name);
	const item = newsletter.items.find((entry) => entry.id === field.itemId);
	if (!item) throw new Error('The selected newsletter item no longer exists.');
	return fieldValue(item.fields, field.name);
}

export function updatePreviewField(newsletter: Newsletter, field: PreviewField, value: string): Newsletter {
	if (field.itemId === null) {
		return { ...newsletter, fields: { ...newsletter.fields, [field.name]: value } };
	}
	if (!newsletter.items.some((item) => item.id === field.itemId)) throw new Error('The selected newsletter item no longer exists.');
	return { ...newsletter, items: newsletter.items.map((item) => {
		if (item.id !== field.itemId) return item;
		return { ...item, fields: { ...item.fields, [field.name]: value } };
	}) };
}
