import { describe, expect, it, vi } from 'vitest';
import { contactInput, signatureDownloadLinkText, signatureInstructions, signatureName, variationInput } from './signatures';
import { encodeRichText, RICH_TEXT_PREFIX } from '../rich-text';

vi.mock('./runtime', () => ({ getRuntime: vi.fn() }));

describe('signature input validation', () => {
	it('normalizes download link labels as bounded plain text', () => {
		expect(signatureDownloadLinkText('  Get <your signature> & install  ')).toBe('Get <your signature> & install');
		expect(signatureDownloadLinkText('x'.repeat(200))).toHaveLength(200);
		for (const value of [undefined, null, 1, '', ' ', 'x'.repeat(201), 'Bad\nlabel', 'Bad\rlabel', 'Bad\tlabel', 'Bad\0label', 'Bad\u007flabel']) {
			expect(() => signatureDownloadLinkText(value)).toThrow();
		}
	});

	it('validates legacy text and formatted instructions and allows clearing them', () => {
		expect(signatureInstructions('  Install your signature.\nKeep this link.  ')).toBe('Install your signature.\nKeep this link.');
		expect(signatureInstructions(' ')).toBe('');
		expect(signatureInstructions('x'.repeat(10000))).toHaveLength(10000);
		const formatted = encodeRichText({ type: 'doc', content: [{ type: 'orderedList', content: [
			{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Install', marks: [{ type: 'bold' }, { type: 'italic' }] }] }] }
		] }] });
		expect(signatureInstructions(formatted)).toBe(formatted);
		expect(signatureInstructions(encodeRichText({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBe('');
		expect(signatureInstructions(encodeRichText({ type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] }))).toBe('');
		for (const value of [null, undefined, 1, 'bad\0text', 'x'.repeat(10001), RICH_TEXT_PREFIX + '{', RICH_TEXT_PREFIX + '{"type":"doc","content":[{"type":"script"}]}']) {
			expect(() => signatureInstructions(value)).toThrow();
		}
	});

	it('normalizes names and contact values without discarding custom fields', () => {
		expect(signatureName('  Sales  ')).toBe('Sales');
		expect(contactInput({ fields: { name: '  Jane ', email: ' Jane@example.test ', phone: ' +31 123 ', job_title: ' Designer ' } })).toEqual({ name: 'Jane', email: 'Jane@example.test', phone: '+31 123', job_title: 'Designer' });
	});

	it.each([undefined, null, 123, '', ' ', 'jane', 'jane@', 'jane@example', 'Jane <jane@example.test>', 'jane@example.test\nBcc:other@example.test', `${'x'.repeat(242)}@example.test`])('requires a valid contact email: %s', (email) => {
		expect(() => contactInput({ fields: { name: 'Jane', email } })).toThrow();
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
