export type FieldType = 'text' | 'textarea' | 'url' | 'image' | 'number';
export interface TemplateField {
	name: string;
	type: FieldType;
}
export type FieldValues = Record<string, string>;
export type FieldScope = 'template' | 'item';

const types: readonly string[] = ['text', 'textarea', 'url', 'image', 'number'];
function isFieldType(value: string): value is FieldType {
	return types.includes(value);
}

export function validFieldName(name: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(name)
		&& !['__proto__', 'constructor', 'prototype'].includes(name);
}

export function validFieldValues(value: unknown): value is FieldValues {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& Object.entries(value).every(([name, entry]) => validFieldName(name) && typeof entry === 'string');
}

export function fieldValue(values: FieldValues | undefined, name: string): string {
	return values && Object.hasOwn(values, name) ? values[name] : '';
}

export function templateFields(source: string, scope: FieldScope): { fields: TemplateField[]; error: string | null } {
	const fields: TemplateField[] = [];
	const active = source.replace(/<!--[\s\S]*?-->/g, '');
	for (const match of active.matchAll(/{{\s*([^{}]*?)\s*}}/g)) {
		const tag = match[1].trim();
		let field: TemplateField;
		if (tag.includes(':')) {
			const [type, name, extra] = tag.split(':').map((part) => part.trim());
			if (!isFieldType(type) || !validFieldName(name ?? '') || extra !== undefined) {
				return { fields: [], error: `Invalid placeholder {{${tag}}}. Use {{type:name}} with text, textarea, url, image, or number and a valid field name.` };
			}
			field = { name, type };
		} else {
			if (scope === 'template' && ['items', 'newsletter_name'].includes(tag)) continue;
			return { fields: [], error: `Unknown ${scope} placeholder {{${tag}}}. Use ${scope === 'template' ? '{{items}}, {{newsletter_name}}, or ' : ''}{{type:name}}. Untyped content fields are not supported.` };
		}
		const previous = fields.find((entry) => entry.name === field.name);
		if (previous && previous.type !== field.type) {
			return { fields: [], error: `Field "${field.name}" has conflicting types in the ${scope}.` };
		}
		if (!previous) fields.push(field);
	}
	return { fields, error: null };
}

export function validHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
	} catch {
		return false;
	}
}

export function fieldError(field: TemplateField, value: string): string | null {
	if (!value) return null;
	if ((field.type === 'url' || field.type === 'image') && !validHttpUrl(value)) {
		return `Field "${field.name}": use an absolute http:// or https:// URL.`;
	}
	if (field.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
		|| !Number.isFinite(Number(value)))) {
		return `Field "${field.name}": enter a finite number.`;
	}
	return null;
}
