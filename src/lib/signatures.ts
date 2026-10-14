import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { MAX_TEMPLATE_BYTES } from './remote';

export interface EmailSignature {
	id: string;
	name: string;
	revision: number;
}

export interface SignatureVariation {
	id: string;
	name: string;
	filename: string;
	html: string;
}

export interface SignatureContact {
	id: string;
	fields: Record<string, string>;
}

export interface SignatureDetail extends EmailSignature {
	variations: SignatureVariation[];
	contacts: SignatureContact[];
}

export const MAX_SIGNATURE_FIELDS = 50;
export const MAX_CONTACT_VALUE_LENGTH = 2000;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MAX_CONDITION_DEPTH = 50;
const BLOCKED_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'svg', 'math', 'link']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'background', 'poster', 'action', 'formaction', 'xlink:href']);

type TemplateNode = { type: 'text'; value: string } | { type: 'field'; name: string } | ConditionalNode;
interface ConditionalNode {
	type: 'if';
	branches: { field: string | null; nodes: TemplateNode[] }[];
}

function parseTemplate(html: string): { nodes: TemplateNode[]; fields: string[] } {
	const fields = new Set<string>();
	const nodes: TemplateNode[] = [];
	const stack: { node: ConditionalNode; parent: TemplateNode[] }[] = [];
	let current = nodes;
	let offset = 0;

	function fieldName(field: string) {
		if (!FIELD_NAME.test(field) || ['__proto__', 'constructor', 'prototype'].includes(field)) throw new Error('Use simple contact fields such as {{ name }} or {{#if phone}}. Only if/else conditions are supported; other helpers, nested paths, and raw HTML placeholders are not supported.');
		fields.add(field);
		return field;
	}

	function text(value: string) {
		if (/{{|}}/.test(value)) throw new Error('The HTML contains an incomplete or unsupported placeholder.');
		if (value) current.push({ type: 'text', value });
	}

	for (const match of html.matchAll(/{{([\s\S]*?)}}/g)) {
		text(html.slice(offset, match.index));
		offset = match.index + match[0].length;
		const token = match[1].trim();
		if (/^#if(?:\s|$)/.test(token)) {
			if (stack.length >= MAX_CONDITION_DEPTH) throw new Error(`Signature conditions may nest at most ${MAX_CONDITION_DEPTH} levels.`);
			const node: ConditionalNode = { type: 'if', branches: [{ field: fieldName(token.slice(3).trim()), nodes: [] }] };
			current.push(node);
			stack.push({ node, parent: current });
			current = node.branches[0].nodes;
		} else if (token === 'else' || /^else\s+if(?:\s|$)/.test(token)) {
			const frame = stack.at(-1);
			if (!frame) throw new Error('{{else}} must be inside an {{#if field}} block.');
			if (frame.node.branches.at(-1)?.field === null) throw new Error('An if block cannot contain another else after its final {{else}}.');
			const branch = { field: token === 'else' ? null : fieldName(token.replace(/^else\s+if\s*/, '')), nodes: [] };
			frame.node.branches.push(branch);
			current = branch.nodes;
		} else if (token === '/if') {
			const frame = stack.pop();
			if (!frame) throw new Error('{{/if}} has no matching {{#if field}}.');
			current = frame.parent;
		} else {
			current.push({ type: 'field', name: fieldName(token) });
		}
	}
	text(html.slice(offset));
	if (stack.length) throw new Error('Every {{#if field}} block must end with {{/if}}.');
	if (fields.size > MAX_SIGNATURE_FIELDS) throw new Error(`Use no more than ${MAX_SIGNATURE_FIELDS} contact fields per variation.`);
	return { nodes, fields: [...fields].sort() };
}

export function signatureFields(html: string): string[] {
	return parseTemplate(html).fields;
}

export function contactFields(variations: Pick<SignatureVariation, 'html'>[]): string[] {
	return [...new Set(['name', ...variations.flatMap((variation) => signatureFields(variation.html))])].sort((a, b) => a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b));
}

function validateHtml(html: string, template = false) {
	function visit(node: DefaultTreeAdapterMap['node']) {
		if ('tagName' in node) {
			if (BLOCKED_ELEMENTS.has(node.tagName) || /{{|}}/.test(node.tagName)) throw new Error('Signature HTML cannot contain scripts, forms, embedded documents, or placeholders in tag names.');
			for (const attr of node.attrs) {
				if (/^on/i.test(attr.name) || ['srcdoc', 'srcset', 'ping'].includes(attr.name) || /{{|}}/.test(attr.name)) throw new Error('Signature HTML contains an unsupported or active attribute.');
				if (template && attr.value.includes('{{')) {
					const location = node.sourceCodeLocation?.attrs?.[attr.name];
					const source = location ? html.slice(location.startOffset, location.endOffset) : '';
					if (attr.name === 'style' || !/=\s*(?:"[^"]*"|'[^']*')$/.test(source)) throw new Error('Placeholders in attributes must use quoted values and cannot be used in CSS.');
				}
				if (URL_ATTRIBUTES.has(attr.name)) {
					const value = attr.value.replace(/[\u0000-\u0020\u007f]/g, '');
					if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(https?:|mailto:|tel:|cid:)/i.test(value)
						&& !(attr.name === 'src' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value))) {
						throw new Error('Signature links and images must use HTTP(S), mailto, tel, cid, or embedded raster images.');
					}
				}
			}
			if (node.tagName === 'meta' && node.attrs.some((attr) => attr.name === 'http-equiv')) throw new Error('Signature HTML cannot contain HTTP-equivalent meta tags.');
			if (template && node.tagName === 'style' && node.childNodes.some((child) => 'value' in child && child.value.includes('{{'))) throw new Error('Contact placeholders cannot be used in CSS.');
			if ('content' in node) visit(node.content);
		}
		if ('childNodes' in node) node.childNodes.forEach(visit);
	}
	visit(parse(html, { sourceCodeLocationInfo: template }));
}

function validatedTemplate(html: string) {
	if (!html.trim() || new TextEncoder().encode(html).length > MAX_TEMPLATE_BYTES) throw new Error('Upload non-empty HTML no larger than 1 MB.');
	if (html.includes('\0')) throw new Error('Signature HTML cannot contain null characters.');
	const template = parseTemplate(html);
	validateHtml(html, true);
	return template;
}

export function validateSignatureTemplate(html: string): string[] {
	return validatedTemplate(html).fields;
}

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function renderSignature(html: string, fields: Record<string, string>): string {
	const template = validatedTemplate(html);
	function render(nodes: TemplateNode[]): string {
		return nodes.map((node) => {
			if (node.type === 'text') return node.value;
			if (node.type === 'field') {
				if (!Object.hasOwn(fields, node.name) || typeof fields[node.name] !== 'string') throw new Error(`This contact is missing "${node.name}". Edit and save the contact before exporting.`);
				return escapeHtml(fields[node.name]);
			}
			const branch = node.branches.find(({ field }) => field === null || (Object.hasOwn(fields, field) && typeof fields[field] === 'string' && fields[field].length > 0));
			return branch ? render(branch.nodes) : '';
		}).join('');
	}
	const rendered = render(template.nodes);
	validateHtml(rendered);
	return rendered;
}

export function signatureDownloadName(signature: string, variation: string, contact: string): string {
	return `${[signature, variation, contact].map((name) => name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'signature').join('-')}.html`;
}
