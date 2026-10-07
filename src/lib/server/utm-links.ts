import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { UTM_KEYS, type UtmSettings } from '../utm';

export class UtmLinkError extends Error {}

function trackedUrl(value: string, settings: UtmSettings): string {
	if (!/^https?:\/\//i.test(value)) return value;
	let url: URL;
	try { url = new URL(value); }
	catch { throw new UtmLinkError(`Cannot add UTM settings to an invalid HTTP(S) link: ${value}`); }
	if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(url.pathname)) return value;
	for (const key of UTM_KEYS) if (settings[key]) url.searchParams.set(key, settings[key]);
	return url.href;
}

export function applyUtmLinks(source: string, settings: UtmSettings): string {
	if (!UTM_KEYS.some((key) => settings[key])) return source;
	const tree = parseFragment(source, { sourceCodeLocationInfo: true });
	const changes = new Map<number, { start: number; end: number; text: string }>();
	function visit(node: DefaultTreeAdapterMap['node']) {
		if ('tagName' in node) {
			if (['script', 'style', 'title', 'textarea', 'mj-style', 'mj-title', 'mj-preview'].includes(node.tagName)) return;
			const href = node.attrs.find((attribute) => attribute.name === 'href');
			const location = node.sourceCodeLocation?.attrs?.href;
			if (href && location && !['link', 'base', 'mj-font'].includes(node.tagName)) {
				const value = trackedUrl(href.value, settings);
				if (value !== href.value) {
					const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					changes.set(location.startOffset, { start: location.startOffset, end: location.endOffset, text: `href="${escaped}"` });
				}
			}
			if (node.tagName === 'template' && 'content' in node) visit(node.content);
		}
		if ('nodeName' in node && node.nodeName === '#comment' && 'data' in node) {
			const conditional = node.data.match(/^(\[if\b[^\]]*\]>)([\s\S]*)(<!\[endif\])$/i);
			const location = node.sourceCodeLocation;
			if (conditional && location) {
				const tracked = applyUtmLinks(conditional[2], settings);
				if (tracked !== conditional[2]) changes.set(location.startOffset, {
					start: location.startOffset, end: location.endOffset,
					text: `<!--${conditional[1]}${tracked}${conditional[3]}-->`
				});
			}
		}
		if ('childNodes' in node) for (const child of node.childNodes) visit(child);
	}
	visit(tree);
	let result = source;
	for (const change of [...changes.values()].sort((a, b) => b.start - a.start)) {
		result = result.slice(0, change.start) + change.text + result.slice(change.end);
	}
	return result;
}
