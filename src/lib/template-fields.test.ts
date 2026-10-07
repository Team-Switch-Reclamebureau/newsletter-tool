import { describe, expect, it } from 'vitest';
import { fieldError, fieldValue, templateFields, validFieldValues } from './template-fields';

describe('template field discovery', () => {
	it('supports spaced image tags in both template scopes', () => {
		for (const scope of ['template', 'item'] as const) {
			expect(templateFields('{{ image:hero_image }}', scope)).toEqual({
				fields: [{ name: 'hero_image', type: 'image', typed: true }], error: null
			});
		}
	});

	it('discovers types in order and reuses repeated fields', () => {
		const result = templateFields('{{ text:heading }}{{textarea:body}}{{image:photo}}{{url:link}}{{number:price}}{{text:heading}}', 'item');
		expect(result.error).toBeNull();
		expect(result.fields.map(({ name, type }) => [name, type])).toEqual([
			['heading', 'text'], ['body', 'textarea'], ['photo', 'image'], ['link', 'url'], ['price', 'number']
		]);
	});

	it('supports legacy tags and ignores commented placeholders', () => {
		expect(templateFields('{{items}}{{newsletter_name}}<!-- {{bad:tag}} -->{{text:heading}}', 'template').fields).toEqual([
			{ name: 'heading', type: 'text', typed: true }
		]);
		expect(templateFields('{{title}}{{text}}{{text:title}}', 'item').fields).toEqual([
			{ name: 'title', type: 'text', typed: false },
			{ name: 'text', type: 'textarea', typed: false },
			{ name: 'title', type: 'text', typed: true }
		]);
	});

	it('rejects conflicting types, unsupported types, names and scopes', () => {
		for (const source of ['{{text:heading}}{{number:heading}}', '{{html:body}}', '{{text:}}',
			'{{text:two words}}', '{{text:a:b}}', '{{text:constructor}}', '{{text:__proto__}}', '{{text:1name}}']) {
			expect(templateFields(source, 'item').error).not.toBeNull();
		}
		expect(templateFields('{{title}}', 'template').error).toContain('Unknown template');
		expect(templateFields('{{items}}', 'item').error).toContain('Unknown item');
	});
});

describe('template field values', () => {
	it('accepts only safe string maps and reads only owned values', () => {
		expect(validFieldValues({ 'some.name': 'value', 'some-name': '' })).toBe(true);
		for (const value of [null, [], { count: 1 }, { constructor: 'unsafe' }]) {
			expect(validFieldValues(value)).toBe(false);
		}
		expect(fieldValue(undefined, 'name')).toBe('');
		expect(fieldValue({}, 'toString')).toBe('');
	});

	it('allows empty fields and validates URLs and finite numbers', () => {
		for (const type of ['url', 'image', 'number'] as const) {
			expect(fieldError({ name: 'value', type, typed: true }, '')).toBeNull();
		}
		for (const type of ['url', 'image'] as const) {
			const field = { name: 'link', type, typed: true };
			expect(fieldError(field, 'https://example.com/a?b=1')).toBeNull();
			for (const value of ['javascript:alert(1)', '/relative', 'https://user:password@example.com']) {
				expect(fieldError(field, value)).toContain('http://');
			}
		}
		const number = { name: 'price', type: 'number', typed: true } as const;
		for (const value of ['12', '-0.5', '.25', '1e3']) expect(fieldError(number, value)).toBeNull();
		for (const value of ['Infinity', 'NaN', '0x10', ' ', '1e999', '12px']) expect(fieldError(number, value)).toContain('finite number');
	});
});
