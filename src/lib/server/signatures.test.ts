import { describe, expect, it, vi } from 'vitest';
import { contactInput, signatureName, variationInput } from './signatures';

vi.mock('./runtime', () => ({ getRuntime: vi.fn() }));

describe('signature input validation', () => {
	it('normalizes names and contact values without discarding custom fields', () => {
		expect(signatureName('  Sales  ')).toBe('Sales');
		expect(contactInput({ fields: { name: '  Jane ', phone: ' +31 123 ', job_title: ' Designer ' } })).toEqual({ name: 'Jane', phone: '+31 123', job_title: 'Designer' });
	});

	it.each([undefined, null, 1, '', ' ', 'x'.repeat(161), 'Invalid\0name'])('requires a bounded name: %s', (name) => {
		expect(() => signatureName(name)).toThrow();
	});

	it.each([
		{},
		{ fields: [] },
		{ fields: { phone: '123' } },
		{ fields: { name: 'Jane', phone: 123 } },
		{ fields: { name: 'Jane', phone: 'x'.repeat(2001) } },
		{ fields: { name: 'Jane', phone: '\0' } },
		{ fields: { name: 'Jane', 'not a field': 'value' } },
		{ fields: JSON.parse('{"name":"Jane","__proto__":"value"}') },
		{ fields: { name: 'Jane', constructor: 'value' } },
		{ fields: Object.fromEntries([['name', 'Jane'], ...Array.from({ length: 50 }, (_, index) => [`field${index}`, 'value'])]) }
	])('rejects invalid contact input', (body) => {
		expect(() => contactInput(body)).toThrow();
	});

	it('requires a .html upload and validates its source', () => {
		expect(variationInput({ name: ' Basic ', filename: 'basic.HTML', html: '<p>{{name}}</p>' })).toEqual({ name: 'Basic', filename: 'basic.HTML', html: '<p>{{name}}</p>' });
		for (const filename of ['basic.htm', '../basic.html', 'basic\\file.html', 'bad\nfile.html']) {
			expect(() => variationInput({ name: 'Basic', filename, html: '<p>{{name}}</p>' })).toThrow();
		}
		expect(() => variationInput({ name: 'Basic', filename: 'basic.html', html: '<script>x</script>' })).toThrow();
	});

	it('accepts balanced if/else templates and rejects malformed blocks during upload', () => {
		const html = '<p>{{name}}{{#if phone}} {{phone}}{{else if email}} {{email}}{{else}} Office{{/if}}</p>';
		expect(variationInput({ name: 'Conditional', filename: 'conditional.html', html }).html).toBe(html);
		for (const invalid of ['{{else}}', '{{#if phone}}Unclosed', '{{#if phone}}{{else}}{{else}}{{/if}}']) {
			expect(() => variationInput({ name: 'Conditional', filename: 'conditional.html', html: invalid })).toThrow();
		}
	});
});
