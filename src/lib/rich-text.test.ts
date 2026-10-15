import { describe, expect, it } from 'vitest';
import { encodeRichText, renderRichText, richTextDocument, richTextPlainText, RICH_TEXT_PREFIX, validRichTextLink } from './rich-text';
import { fieldError } from './template-fields';

describe('formatted textarea storage and rendering', () => {
	it('renders bold and italic ordered-list items as safe HTML and numbered plain text', () => {
		const value = encodeRichText({ type: 'doc', content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Instructions', marks: [{ type: 'bold' }] }] },
			{ type: 'orderedList', attrs: { start: 1, type: null }, content: [
				{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Download <signature.html>', marks: [{ type: 'bold' }] }] }] },
				{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open your settings', marks: [{ type: 'italic' }] }] }] }
			] }
		] });
		expect(renderRichText(value)).toBe('<strong>Instructions</strong><br /><ol><li><strong>Download &lt;signature.html&gt;</strong></li><li><em>Open your settings</em></li></ol>');
		expect(richTextPlainText(value)).toBe('Instructions\n1. Download <signature.html>\n2. Open your settings');
		expect(richTextPlainText('Legacy <text>\r\nNext line')).toBe('Legacy <text>\nNext line');
	});

	it('supports nested ordered lists and safe starting numbers', () => {
		const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
		const value = encodeRichText({ type: 'doc', content: [
			{ type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [
				{ type: 'listItem', content: [paragraph('Install'), { type: 'orderedList', content: [
					{ type: 'listItem', content: [paragraph('Open settings')] }
				] }] },
				{ type: 'listItem', content: [paragraph('Save')] }
			] }
		] });
		expect(renderRichText(value)).toBe('<ol start="3" type="a"><li>Install<br /><ol><li>Open settings</li></ol></li><li>Save</li></ol>');
		expect(richTextPlainText(value)).toBe('3. Install\n   1. Open settings\n4. Save');
	});

	it('preserves safe links in the plain-text alternative', () => {
		const value = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: 'Help', marks: [{ type: 'link', attrs: { href: 'https://example.test/help' } }] },
			{ type: 'hardBreak' },
			{ type: 'text', text: 'https://example.test', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] }
		] }] });
		expect(richTextPlainText(value)).toBe('Help (https://example.test/help)\nhttps://example.test');
	});

	it('rejects malformed list structures, unsafe attributes, invalid numbering, and excessive nesting', () => {
		const item = { type: 'listItem', content: [{ type: 'paragraph' }] };
		for (const list of [
			{ type: 'orderedList', content: [] },
			{ type: 'orderedList', content: [{ type: 'paragraph' }] },
			{ type: 'orderedList', content: [{ type: 'listItem', content: [] }] },
			{ type: 'orderedList', content: [{ ...item, attrs: { onclick: 'alert(1)' } }] },
			...[0, -1, 1.5, '1', 2147483648].map((start) => ({ type: 'orderedList', attrs: { start }, content: [item] })),
			{ type: 'orderedList', attrs: { type: '" onclick="alert(1)' }, content: [item] },
			{ type: 'orderedList', attrs: { type: 1 }, content: [item] },
			{ type: 'orderedList', attrs: { style: 'color:red' }, content: [item] }
		]) {
			expect(() => encodeRichText({ type: 'doc', content: [list] })).toThrow('Invalid formatted text');
		}
		let nested: unknown = { type: 'paragraph' };
		for (let depth = 0; depth < 22; depth++) nested = { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, nested] }] };
		expect(() => encodeRichText({ type: 'doc', content: [nested] })).toThrow('Invalid formatted text');
	});

	it('preserves legacy text, literal markup, spaces, and all line breaks', () => {
		for (const value of ['', '  Plain <strong>text</strong> & "quotes"  ', 'First\nSecond\n\n']) {
			const document = richTextDocument(value);
			expect(renderRichText(encodeRichText(document))).toBe(renderRichText(value));
		}
		expect(renderRichText('<strong>Not formatting</strong>')).toBe('&lt;strong&gt;Not formatting&lt;/strong&gt;');
		expect(renderRichText('First\r\nSecond\n\n')).toBe('First<br />Second<br /><br />');
		expect(richTextDocument('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
	});

	it('renders only strong, em and line breaks while escaping all text', () => {
		const value = encodeRichText({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [
					{ type: 'text', text: '<script>alert("x")</script> & {{items}}', marks: [{ type: 'bold' }, { type: 'italic' }] },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'End', marks: [{ type: 'italic' }] }
				] },
				{ type: 'paragraph' }
			]
		});
		expect(value).toMatch(/^newsletter-rich-text:v1:/);
		expect(renderRichText(value)).toBe('<em><strong>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; {{items}}</strong></em><br /><em>End</em><br />');
		expect(fieldError({ name: 'body', type: 'textarea' }, value)).toBeNull();
	});

	it('renders safe link marks with escaped URLs and nested formatting', () => {
		const value = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: '<Read more>', marks: [
				{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://example.test/story?x=1&y="2"#part' } }
			] }
		] }] });
		expect(renderRichText(value)).toBe('<a href="https://example.test/story?x=1&amp;y=&quot;2&quot;#part"><em><strong>&lt;Read more&gt;</strong></em></a>');
		expect(fieldError({ name: 'body', type: 'textarea' }, value)).toBeNull();
	});

	it('rejects unsafe and untrackable link URLs and extra attributes', () => {
		for (const href of ['javascript:alert(1)', 'data:text/html,test', '/relative', '#anchor',
			'http:example.test', ' https://example.test', 'https://example.test\n', 'https://user:password@example.test',
			'mailto:', 'mailto:?subject=Hello', 'tel:', 'tel://example.test', 'mailto://example.test', 'mailto://[', 'file:///etc/passwd']) {
			expect(validRichTextLink(href)).toBe(false);
			const document = { type: 'doc', content: [{ type: 'paragraph', content: [
				{ type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href } }] }
			] }] };
			expect(() => encodeRichText(document)).toThrow('Invalid formatted text');
		}
		for (const attrs of [
			{ href: 'https://example.test', onclick: 'alert(1)' },
			{ href: 'https://example.test', style: 'color:red' },
			{ href: 'https://example.test', target: '_blank' }
		]) {
			expect(() => encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
				{ type: 'text', text: 'Link', marks: [{ type: 'link', attrs }] }
			] }] })).toThrow('Invalid formatted text');
		}
	});

	it('accepts telephone and email links without changing their destinations', () => {
		for (const href of ['tel:+31201234567', 'tel:+31-20-123-4567;ext=42',
			'mailto:team@example.test', 'mailto:team@example.test?subject=Hello%20there&body=First%0ASecond']) {
			expect(validRichTextLink(href)).toBe(true);
			const value = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
				{ type: 'text', text: 'Contact us', marks: [{ type: 'link', attrs: { href } }] }
			] }] });
			expect(renderRichText(value)).toBe(`<a href="${href.replace(/&/g, '&amp;')}">Contact us</a>`);
			expect(fieldError({ name: 'body', type: 'textarea' }, value)).toBeNull();
		}
	});

	it('preserves the exact Mailchimp unsubscribe merge tag in link storage and output', () => {
		const href = '*|UNSUB|*';
		expect(validRichTextLink(href)).toBe(true);
		const value = encodeRichText({ type: 'doc', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: 'Unsubscribe', marks: [{ type: 'link', attrs: { href } }] }
		] }] });
		expect(richTextDocument(value).content[0].content?.[0]).toMatchObject({ marks: [{ type: 'link', attrs: { href } }] });
		expect(renderRichText(value)).toBe('<a href="*|UNSUB|*">Unsubscribe</a>');
		expect(fieldError({ name: 'body', type: 'textarea' }, value)).toBeNull();
		for (const invalid of ['*|UNSUB|*?utm_source=mail', '*|UNSUB|*#anchor', '*|UPDATE_PROFILE|*', '*|unsub|*', '%2A%7CUNSUB%7C%2A', ' *|UNSUB|*']) {
			expect(validRichTextLink(invalid)).toBe(false);
		}
	});

	it('rejects malformed encoded content explicitly rather than treating it as plain text', () => {
		expect(() => richTextDocument(RICH_TEXT_PREFIX + '{')).toThrow('not valid JSON');
		expect(fieldError({ name: 'body', type: 'textarea' }, RICH_TEXT_PREFIX + '{}')).toContain('Field "body": Invalid formatted text');
	});

	it('rejects unsupported nodes, marks, attributes, and document shapes on the server path', () => {
		const paragraph = (content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
		for (const document of [
			null, { type: 'doc', content: [] },
			{ type: 'doc', content: [{ type: 'heading', content: [] }] },
			{ type: 'doc', attrs: { onclick: 'alert(1)' }, content: [{ type: 'paragraph' }] },
			{ type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'color:red' } }] },
			paragraph([{ type: 'image', attrs: { src: 'javascript:alert(1)' } }]),
			paragraph([{ type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }]),
			paragraph([{ type: 'text', text: 'Bad', marks: [{ type: 'bold', attrs: { onclick: 'alert(1)' } }] }]),
			paragraph([{ type: 'text', text: 'Bad', marks: [{ type: 'bold' }, { type: 'bold' }] }]),
			paragraph([{ type: 'text', text: 'Bad', unexpected: '<img>' }]),
			paragraph([{ type: 'hardBreak', attrs: { onclick: 'alert(1)' } }]),
			paragraph([{ type: 'text', text: '' }])
		]) {
			expect(() => encodeRichText(document)).toThrow('Invalid formatted text');
			const value = RICH_TEXT_PREFIX + JSON.stringify(document);
			expect(() => renderRichText(value)).toThrow('Invalid formatted text');
			expect(fieldError({ name: 'body', type: 'textarea' }, value)).toContain('Invalid formatted text');
		}
	});
});
