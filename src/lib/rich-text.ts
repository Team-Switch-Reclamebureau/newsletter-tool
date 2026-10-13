import { validHttpUrl } from './http-url';

export const RICH_TEXT_PREFIX = 'newsletter-rich-text:v1:';

type RichTextMark = { type: 'bold' | 'italic' } | { type: 'link'; attrs: { href: string } };

type RichTextInline = { type: 'text'; text: string; marks?: RichTextMark[] } | { type: 'hardBreak' };
interface RichTextParagraph {
	type: 'paragraph';
	content?: RichTextInline[];
}
export interface RichTextDocument {
	type: 'doc';
	content: RichTextParagraph[];
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

export function validRichTextLink(value: unknown): value is string {
	if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
	if (/^https?:\/\//i.test(value)) return validHttpUrl(value);
	if (!/^(mailto|tel):/i.test(value)) return false;
	const destination = value.slice(value.indexOf(':') + 1).split(/[?#]/, 1)[0];
	return Boolean(destination.trim()) && !destination.startsWith('/');
}

function validMark(value: unknown): value is RichTextMark {
	if (!record(value)) return false;
	if (value.type === 'bold' || value.type === 'italic') return keys(value, ['type']);
	return value.type === 'link' && keys(value, ['type', 'attrs'])
		&& record(value.attrs) && keys(value.attrs, ['href']) && validRichTextLink(value.attrs.href);
}

function validInline(value: unknown): value is RichTextInline {
	if (!record(value)) return false;
	if (value.type === 'hardBreak') return keys(value, ['type']);
	if (value.type !== 'text' || typeof value.text !== 'string' || !value.text.length || !keys(value, ['type', 'text', 'marks'])) return false;
	return value.marks === undefined || (Array.isArray(value.marks)
		&& value.marks.length <= 3
		&& value.marks.every(validMark)
		&& new Set(value.marks.map((mark) => mark.type)).size === value.marks.length);
}

function validDocument(value: unknown): value is RichTextDocument {
	return record(value) && keys(value, ['type', 'content']) && value.type === 'doc'
		&& Array.isArray(value.content) && value.content.length > 0
		&& value.content.every((paragraph) => record(paragraph) && keys(paragraph, ['type', 'content'])
			&& paragraph.type === 'paragraph'
			&& (paragraph.content === undefined || (Array.isArray(paragraph.content) && paragraph.content.every(validInline))));
}

export function richTextDocument(value: string): RichTextDocument {
	if (!value.startsWith(RICH_TEXT_PREFIX)) {
		return {
			type: 'doc',
			content: value.replace(/\r\n/g, '\n').split('\n').map((line) => ({
				type: 'paragraph',
				...(line ? { content: [{ type: 'text', text: line }] } : {})
			}))
		};
	}
	let document: unknown;
	try { document = JSON.parse(value.slice(RICH_TEXT_PREFIX.length)); }
	catch (cause) { throw new Error('Invalid formatted text: the saved document is not valid JSON.', { cause }); }
	if (!validDocument(document)) throw new Error('Invalid formatted text: only paragraphs, line breaks, bold, italic, and safe HTTP(S), mailto, or tel links are supported.');
	return document;
}

export function encodeRichText(document: unknown): string {
	if (!validDocument(document)) throw new Error('Invalid formatted text: only paragraphs, line breaks, bold, italic, and safe HTTP(S), mailto, or tel links are supported.');
	return RICH_TEXT_PREFIX + JSON.stringify(document);
}

export function escapeMarkup(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character] ?? character);
}

export function renderRichText(value: string): string {
	return richTextDocument(value).content.map((paragraph) => (paragraph.content ?? []).map((node) => {
		if (node.type === 'hardBreak') return '<br />';
		let text = escapeMarkup(node.text).replace(/\r?\n/g, '<br />');
		for (const mark of node.marks ?? []) {
			if (mark.type === 'link') {
				text = `<a href="${escapeMarkup(mark.attrs.href)}">${text}</a>`;
				continue;
			}
			const tag = mark.type === 'bold' ? 'strong' : 'em';
			text = `<${tag}>${text}</${tag}>`;
		}
		return text;
	}).join('')).join('<br />');
}
