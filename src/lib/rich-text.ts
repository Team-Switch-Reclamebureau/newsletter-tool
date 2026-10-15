import { validHttpUrl } from './http-url';

export const RICH_TEXT_PREFIX = 'newsletter-rich-text:v1:';

type RichTextMark = { type: 'bold' | 'italic' } | { type: 'link'; attrs: { href: string } };

export type RichTextInline = { type: 'text'; text: string; marks?: RichTextMark[] } | { type: 'hardBreak' };
interface RichTextParagraph {
	type: 'paragraph';
	content?: RichTextInline[];
}
interface RichTextOrderedList {
	type: 'orderedList';
	attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null };
	content: { type: 'listItem'; content: RichTextBlock[] }[];
}
export type RichTextBlock = RichTextParagraph | RichTextOrderedList;
export interface RichTextDocument {
	type: 'doc';
	content: RichTextBlock[];
}
const INVALID_DOCUMENT = 'Invalid formatted text: only paragraphs, ordered lists, line breaks, bold, italic, and safe HTTP(S), mailto, tel, or *|UNSUB|* links are supported.';

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

export function validRichTextLink(value: unknown): value is string {
	if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
	if (value === '*|UNSUB|*') return true;
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

function validBlock(value: unknown, depth = 0): value is RichTextBlock {
	if (depth > 20 || !record(value)) return false;
	if (value.type === 'paragraph') return keys(value, ['type', 'content'])
		&& (value.content === undefined || (Array.isArray(value.content) && value.content.every(validInline)));
	if (value.type !== 'orderedList' || !keys(value, ['type', 'attrs', 'content'])) return false;
	if (value.attrs !== undefined && (!record(value.attrs) || !keys(value.attrs, ['start', 'type'])
		|| (value.attrs.start !== undefined && (typeof value.attrs.start !== 'number' || !Number.isInteger(value.attrs.start) || value.attrs.start < 1 || value.attrs.start > 2147483647))
		|| (value.attrs.type !== undefined && value.attrs.type !== null && (typeof value.attrs.type !== 'string' || !['1', 'a', 'A', 'i', 'I'].includes(value.attrs.type))))) return false;
	return Array.isArray(value.content) && value.content.length > 0
		&& value.content.every((item) => record(item) && keys(item, ['type', 'content'])
			&& item.type === 'listItem' && Array.isArray(item.content) && item.content.length > 0
			&& record(item.content[0]) && item.content[0].type === 'paragraph'
			&& item.content.every((block) => validBlock(block, depth + 1)));
}

function validDocument(value: unknown): value is RichTextDocument {
	return record(value) && keys(value, ['type', 'content']) && value.type === 'doc'
		&& Array.isArray(value.content) && value.content.length > 0
		&& value.content.every((block) => validBlock(block));
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
	if (!validDocument(document)) throw new Error(INVALID_DOCUMENT);
	return document;
}

export function encodeRichText(document: unknown): string {
	if (!validDocument(document)) throw new Error(INVALID_DOCUMENT);
	return RICH_TEXT_PREFIX + JSON.stringify(document);
}

export function escapeMarkup(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character] ?? character);
}

export function renderRichText(value: string): string {
	function renderBlocks(blocks: RichTextBlock[]): string {
		return blocks.map((block) => {
			if (block.type === 'orderedList') {
				const start = block.attrs?.start ?? 1;
				const type = block.attrs?.type;
				return `<ol${start === 1 ? '' : ` start="${start}"`}${type ? ` type="${type}"` : ''}>${block.content.map((item) => `<li>${renderBlocks(item.content)}</li>`).join('')}</ol>`;
			}
			return (block.content ?? []).map((node) => renderInline(node)).join('');
		}).join('<br />');
	}
	function renderInline(node: RichTextInline): string {
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
	}
	return renderBlocks(richTextDocument(value).content);
}

export function richTextPlainText(value: string): string {
	function renderBlocks(blocks: RichTextBlock[], indent = ''): string {
		return blocks.map((block) => {
			if (block.type === 'orderedList') {
				return block.content.map((item, index) => {
					const text = renderBlocks(item.content, `${indent}   `);
					if (!text.trim()) return '';
					const lines = text.split('\n');
					return `${indent}${(block.attrs?.start ?? 1) + index}. ${lines[0].slice(indent.length + 3)}${lines.length > 1 ? `\n${lines.slice(1).join('\n')}` : ''}`;
				}).join('\n');
			}
			const text = (block.content ?? []).map((node) => {
				if (node.type === 'hardBreak') return '\n';
				const link = node.marks?.find((mark) => mark.type === 'link');
				return link?.type === 'link' && link.attrs.href !== node.text ? `${node.text} (${link.attrs.href})` : node.text;
			}).join('');
			return indent + text.replace(/\n/g, `\n${indent}`);
		}).join('\n');
	}
	return renderBlocks(richTextDocument(value).content);
}
