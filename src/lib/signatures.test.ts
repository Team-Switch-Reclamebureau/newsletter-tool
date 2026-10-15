import { describe, expect, it } from 'vitest';
import { contactFields, renderSignature, signatureDownloadName, signatureFields, signatureInstructionEmail, validateSignatureTemplate } from './signatures';
import { encodeRichText } from './rich-text';
import { MAX_TEMPLATE_BYTES } from './remote';

describe('instruction email download links', () => {
	const url = 'https://example.test/signature-downloads/token/signature.html';

	it('inserts the editable link label at the tag in HTML and plain text without appending another link', () => {
		const result = signatureInstructionEmail('First {{download_link}} then install.', 'Get <signature> & install', url);
		expect(result.html).toBe(`First <a href="${url}">Get &lt;signature&gt; &amp; install</a> then install.`);
		expect(result.text).toBe(`First Get <signature> & install (${url}) then install.`);
	});

	it('supports whitespace, repeated tags, and label text containing a literal tag', () => {
		const result = signatureInstructionEmail('{{ download_link }} / {{download_link}}', 'Get {{download_link}}', url);
		expect(result.html).toBe(`<a href="${url}">Get {{download_link}}</a> / <a href="${url}">Get {{download_link}}</a>`);
	});

	it('preserves bold and italic formatting when a tag spans text nodes in an ordered list', () => {
		const instructions = encodeRichText({ type: 'doc', content: [
			{ type: 'orderedList', content: [
				{ type: 'listItem', content: [{ type: 'paragraph', content: [
					{ type: 'text', text: 'First ' },
					{ type: 'text', text: '{{down', marks: [{ type: 'bold' }, { type: 'italic' }] },
					{ type: 'text', text: 'load_link}}' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'Then install.' }
				] }] }
			] }
		] });
		const result = signatureInstructionEmail(instructions, 'Get signature', url);
		expect(result.html).toBe(`<ol><li>First <a href="${url}"><em><strong>Get signature</strong></em></a><br />Then install.</li></ol>`);
		expect(result.text).toBe(`1. First Get signature (${url})\n   Then install.`);
	});

	it('replaces any existing link on a tag instead of nesting links or keeping the wrong URL', () => {
		const instructions = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: '{{download_link}}', marks: [{ type: 'link', attrs: { href: 'https://old.example.test' } }] }
		] }] });
		expect(signatureInstructionEmail(instructions, 'Get signature', url).html).toBe(`<a href="${url}">Get signature</a>`);
	});

	it('keeps legacy instructions and appends the editable label when the tag is absent', () => {
		const result = signatureInstructionEmail('Install <carefully>.', 'Download & install', url);
		expect(result.text).toBe(`Install <carefully>.\n\nDownload & install:\n${url}`);
		expect(result.html).toBe(`Install &lt;carefully&gt;.<p><a href="${url}">Download &amp; install</a></p>`);
	});
});

describe('signature placeholders and contact fields', () => {
	it('extracts unique fields with optional whitespace and preserves case', () => {
		expect(signatureFields('<p>{{ name }} {{phone}} {{ name }} {{job_title}} {{Office}}</p>')).toEqual(['Office', 'job_title', 'name', 'phone']);
	});

	it('combines all variation fields and always includes a contact name and email', () => {
		expect(contactFields([{ html: '<p>{{phone}}</p>' }, { html: '<a href="mailto:{{email}}">{{phone}}</a>' }])).toEqual(['name', 'email', 'phone']);
		expect(contactFields([])).toEqual(['name', 'email']);
		expect(contactFields([{ html: '<p>{{phone}}</p>' }])).toEqual(['name', 'email', 'phone']);
	});

	it.each(['{{{ name }}}', '{{ name', '{{#if name}}', '{{contact.name}}', '{{ name phone }}', '{{ __proto__ }}'])('rejects unsupported syntax: %s', (html) => {
		expect(() => signatureFields(html)).toThrow();
	});

	it('limits the number of unique placeholders', () => {
		expect(() => signatureFields(Array.from({ length: 51 }, (_, index) => `{{field${index}}}`).join(' '))).toThrow('50');
	});

	it('discovers fields from conditions and every branch, including nested blocks', () => {
		expect(signatureFields('{{#if phone}}{{name}} {{phone}}{{else if email}}{{#if job_title}}{{job_title}}{{/if}}{{email}}{{else}}{{office}}{{/if}}')).toEqual(['email', 'job_title', 'name', 'office', 'phone']);
		expect(contactFields([{ html: '{{#if mobile}}{{mobile}}{{else}}{{phone}}{{/if}}' }, { html: '{{#if email}}Email available{{/if}}' }])).toEqual(['name', 'email', 'mobile', 'phone']);
	});

	it('counts condition-only fields toward the limit', () => {
		expect(() => signatureFields(Array.from({ length: 51 }, (_, index) => `{{#if field${index}}}present{{/if}}`).join(''))).toThrow('50');
	});
});

describe('signature if/else conditions', () => {
	it('renders the true branch for non-empty values and the else branch for empty or missing values', () => {
		const html = '<p>{{name}}</p>{{#if phone}}<a href="tel:{{phone}}">{{phone}}</a>{{else}}<span>No phone</span>{{/if}}';
		expect(renderSignature(html, { name: 'Jane', phone: '+31 123' })).toBe('<p>Jane</p><a href="tel:+31 123">+31 123</a>');
		expect(renderSignature(html, { name: 'Jane', phone: '' })).toBe('<p>Jane</p><span>No phone</span>');
		expect(renderSignature(html, { name: 'Jane' })).toBe('<p>Jane</p><span>No phone</span>');
	});

	it('permits conditions without an else branch', () => {
		const html = 'Before{{#if phone}} {{phone}}{{/if}} after';
		expect(renderSignature(html, { phone: '123' })).toBe('Before 123 after');
		expect(renderSignature(html, {})).toBe('Before after');
	});

	it('supports nested conditions and selects only the first matching else-if branch', () => {
		const html = '{{#if phone}}{{#if name}}{{name}}: {{else}}Call: {{/if}}{{phone}}{{else if email}}Email: {{email}}{{else if office}}Office: {{office}}{{else}}No contact details{{/if}}';
		expect(renderSignature(html, { name: 'Jane', phone: '123', email: 'jane@example.test' })).toBe('Jane: 123');
		expect(renderSignature(html, { phone: '123' })).toBe('Call: 123');
		expect(renderSignature(html, { email: 'jane@example.test', office: 'Amsterdam' })).toBe('Email: jane@example.test');
		expect(renderSignature(html, { email: '', office: 'Amsterdam' })).toBe('Office: Amsterdam');
		expect(renderSignature(html, {})).toBe('No contact details');
	});

	it('does not require interpolation values from unselected branches', () => {
		const html = '{{#if phone}}{{phone}} {{extension}}{{else}}{{name}}{{/if}}';
		expect(renderSignature(html, { name: 'Jane' })).toBe('Jane');
		expect(() => renderSignature(html, { name: 'Jane', phone: '123' })).toThrow('missing "extension"');
	});

	it('uses string truthiness and does not read inherited properties', () => {
		const html = '{{#if flag}}Yes{{else}}No{{/if}}';
		for (const flag of ['0', 'false', ' ']) expect(renderSignature(html, { flag })).toBe('Yes');
		expect(renderSignature(html, { flag: '' })).toBe('No');
		expect(renderSignature('{{#if toString}}Inherited{{else}}Own fields only{{/if}}', {})).toBe('Own fields only');
	});

	it('supports condition whitespace and preserves surrounding source exactly', () => {
		expect(renderSignature('Start\n{{ #if\tphone }}\n{{ phone }}\n{{ else }}\nNone\n{{ /if }}\nEnd', { phone: '123' })).toBe('Start\n\n123\n\nEnd');
	});

	it('escapes selected values without evaluating template syntax in contact data', () => {
		expect(renderSignature('{{#if name}}<p>{{name}}</p>{{else}}Missing{{/if}}', { name: '<b>{{#if phone}}Injected{{/if}}</b>' })).toBe('<p>&lt;b&gt;{{#if phone}}Injected{{/if}}&lt;/b&gt;</p>');
	});

	it('supports conditions inside quoted attribute values', () => {
		const html = '<a href="{{#if email}}mailto:{{email}}{{else}}https://example.test{{/if}}">{{name}}</a>';
		expect(renderSignature(html, { name: 'Jane', email: 'jane@example.test' })).toBe('<a href="mailto:jane@example.test">Jane</a>');
		expect(renderSignature(html, { name: 'Jane' })).toBe('<a href="https://example.test">Jane</a>');
	});

	it('continues to reject unsafe HTML and URL schemes after branch selection', () => {
		expect(() => renderSignature('<a href="java{{#if flag}}script{{else}}x{{/if}}:alert(1)">Link</a>', { flag: 'yes' })).toThrow('HTTP(S)');
		expect(() => renderSignature('{{#if website}}<a href="{{website}}">Link</a>{{/if}}', { website: 'javascript:alert(1)' })).toThrow('HTTP(S)');
		expect(() => validateSignatureTemplate('{{#if unused}}<script>alert(1)</script>{{/if}}')).toThrow('scripts');
		expect(() => validateSignatureTemplate('<p style="color:{{#if flag}}red{{else}}green{{/if}}">Text</p>')).toThrow('CSS');
	});

	it.each([
		'{{else}}',
		'{{else if phone}}',
		'{{/if}}',
		'{{#if phone}}Missing close',
		'{{#if phone}}Yes{{else}}No{{else}}Again{{/if}}',
		'{{#if phone}}Yes{{else}}No{{else if email}}Email{{/if}}',
		'{{#if}}Yes{{/if}}',
		'{{#if contact.phone}}Yes{{/if}}',
		'{{#if phone email}}Yes{{/if}}',
		'{{#if (eq phone "123")}}Yes{{/if}}',
		'{{#unless phone}}No{{/unless}}',
		'{{#if phone}}{{#if email}}Nested{{/if}}',
		'{{#if phone}}{{name phone}}{{/if}}',
		'{{#if __proto__}}No{{/if}}',
		'{{#if phone}}Yes{{else if}}No{{/if}}'
	])('rejects malformed or unsupported conditions: %s', (html) => {
		expect(() => signatureFields(html)).toThrow();
		expect(() => renderSignature(html, {})).toThrow();
	});

	it('supports the maximum nesting depth and rejects deeper conditions', () => {
		const nested = (depth: number) => '{{#if flag}}'.repeat(depth) + 'Selected' + '{{/if}}'.repeat(depth);
		expect(renderSignature(nested(50), { flag: 'yes' })).toBe('Selected');
		expect(() => signatureFields(nested(51))).toThrow('50 levels');
	});
});

describe('signature HTML rendering', () => {
	it('replaces every occurrence while preserving template structure and non-placeholder content', () => {
		const html = '<!doctype html><html><body><table><tr><td>{{ name }}</td><td><a href="tel:{{phone}}">{{ phone }}</a></td></tr></table><!--keep--></body></html>';
		expect(renderSignature(html, { name: 'Jane & John <Team>', phone: '+31 123' })).toBe('<!doctype html><html><body><table><tr><td>Jane &amp; John &lt;Team&gt;</td><td><a href="tel:+31 123">+31 123</a></td></tr></table><!--keep--></body></html>');
	});

	it('escapes attribute and text values and does not interpret contact content as HTML or placeholders', () => {
		expect(renderSignature('<img alt="{{ name }}" src="https://example.test/logo.png"><p>{{name}}</p>', { name: `"'><script>{{ phone }}</script>` })).toBe('<img alt="&quot;&#39;&gt;&lt;script&gt;{{ phone }}&lt;/script&gt;" src="https://example.test/logo.png"><p>&quot;&#39;&gt;&lt;script&gt;{{ phone }}&lt;/script&gt;</p>');
	});

	it('reports a missing field explicitly but permits saved empty values', () => {
		expect(() => renderSignature('<p>{{name}} {{phone}}</p>', { name: 'Jane' })).toThrow('missing "phone"');
		expect(renderSignature('<p>{{name}} {{phone}}</p>', { name: 'Jane', phone: '' })).toBe('<p>Jane </p>');
		expect(() => renderSignature('<p>{{toString}}</p>', {})).toThrow('missing');
	});

	it.each([
		'<script>alert(1)</script>',
		'<img src="x" onerror="alert(1)">',
		'<iframe src="https://example.test"></iframe>',
		'<form><input></form>',
		'<meta http-equiv="refresh" content="0;url=https://example.test">',
		'<a href="javascript:alert(1)">Link</a>',
		'<a href="java&#x0a;script:alert(1)">Link</a>',
		'<img src="data:image/svg+xml;base64,PHN2Zz4=">',
		'<img srcset="javascript:alert(1)">',
		'<a href={{phone}}>Link</a>',
		'<p title={{name}}>Text</p>',
		'<p style="color:{{color}}">Text</p>',
		'<style>{{style}}</style>'
	])('rejects active HTML or unsafe placeholder contexts: %s', (html) => {
		expect(() => validateSignatureTemplate(html)).toThrow();
	});

	it('rejects dangerous URLs supplied through a contact field', () => {
		expect(() => renderSignature('<a href="{{website}}">Link</a>', { website: 'javascript:alert(1)' })).toThrow('HTTP(S)');
	});

	it('supports common signature markup, styles, email links, and embedded images', () => {
		expect(() => validateSignatureTemplate('<html><head><style>td { color: green; }</style></head><body><table style="border:0"><tr><td><a href="mailto:{{email}}">{{name}}</a><img src="data:image/png;base64,aGVsbG8="></td></tr></table></body></html>')).not.toThrow();
	});

	it('enforces the exact UTF-8 byte limit and requires nonempty HTML', () => {
		expect(() => validateSignatureTemplate(' ')).toThrow('non-empty');
		expect(() => validateSignatureTemplate('x'.repeat(MAX_TEMPLATE_BYTES))).not.toThrow();
		expect(() => validateSignatureTemplate('x'.repeat(MAX_TEMPLATE_BYTES + 1))).toThrow('1 MB');
		expect(() => validateSignatureTemplate('é'.repeat(MAX_TEMPLATE_BYTES))).toThrow('1 MB');
		expect(() => validateSignatureTemplate('<p>\0</p>')).toThrow('null');
	});

	it('generates safe per-contact, per-variation download filenames', () => {
		expect(signatureDownloadName('Company / Brand', 'Dark "mode"', 'Jane\r\nSmith')).toBe('Company-Brand-Dark-mode-Jane-Smith.html');
		expect(signatureDownloadName('', '***', 'é')).toBe('signature-signature-signature.html');
	});
});
