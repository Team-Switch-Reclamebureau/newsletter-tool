import { Editor } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { HardBreak } from '@tiptap/extension-hard-break';
import { UndoRedo } from '@tiptap/extensions';
import { OrderedList, ListItem } from '@tiptap/extension-list';
import { encodeRichText, richTextDocument, validRichTextLink } from './rich-text';

interface RichTextEditorOptions {
	id?: string;
	label: string;
	inline?: boolean;
	orderedLists?: boolean;
	onUpdate: (value: string) => void;
	onFocusChange?: (focused: boolean) => void;
}

export function createRichTextEditor(element: HTMLElement, value: string, options: RichTextEditorOptions) {
	const document = element.ownerDocument;
	const style = document.createElement('style');
	style.textContent = `
		.newsletter-rich-editor { position: relative; font: inherit; }
		.newsletter-rich-editor:not(.inline) { border: 1px solid var(--ui-border, #d7dfcd); border-radius: 5px; background: white; color: var(--ui-text, #34492c); font-size: 12px; }
		.newsletter-rich-toolbar { position: relative; display: flex; flex-wrap: wrap; gap: 4px; padding: 5px; background: var(--ui-soft, #f2f5ec); border-bottom: 1px solid var(--ui-border, #d7dfcd); }
		.newsletter-rich-toolbar button { border: 1px solid #d7dfcd; border-radius: 4px; background: white; color: #34492c; min-width: 30px; padding: 5px 8px; font: 12px system-ui, sans-serif; cursor: pointer; }
		.newsletter-rich-toolbar button[aria-pressed="true"] { background: #dce9cf; border-color: #829e66; }
		.newsletter-rich-toolbar button:disabled { opacity: .4; cursor: default; }
		.newsletter-rich-toolbar button:focus-visible, .newsletter-rich-content:focus-visible { outline: 2px solid #829e66; outline-offset: 2px; }
		.newsletter-rich-content { box-sizing: border-box; width: 100%; min-width: 0; white-space: pre-wrap; line-height: inherit; outline: none; }
		.newsletter-rich-content p { margin: 0; min-height: 1em; }
		.newsletter-rich-content ol { margin: 8px 0; padding-left: 24px; list-style-type: decimal; }
		.newsletter-rich-editor:not(.inline) .newsletter-rich-content { min-height: 85px; padding: 10px 11px; line-height: 1.7; }
		.newsletter-rich-editor.inline { display: inline-block; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }
		.newsletter-rich-editor.inline .newsletter-rich-toolbar { position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; z-index: 1001; border: 1px solid #d7dfcd; border-radius: 5px; box-shadow: 0 2px 8px #0003; white-space: nowrap; }
		.newsletter-rich-toolbar[hidden] { display: none; }
		.newsletter-rich-editor.inline .newsletter-rich-content.is-empty::before { content: "Edit text"; opacity: .45; position: absolute; white-space: nowrap; pointer-events: none; }
		.newsletter-rich-content a { color: inherit; text-decoration: underline; cursor: text; }
		.newsletter-rich-link { position: absolute; left: 0; top: 100%; z-index: 1002; box-sizing: border-box; width: 320px; max-width: 100%; padding: 10px; border: 1px solid #d7dfcd; border-radius: 5px; background: white; box-shadow: 0 2px 8px #0003; font: 12px system-ui, sans-serif; white-space: normal; }
		.newsletter-rich-link[hidden] { display: none; }
		.newsletter-rich-link label { display: block; margin-bottom: 8px; }
		.newsletter-rich-link input { display: block; box-sizing: border-box; width: 100%; padding: 8px; margin-top: 6px; border: 1px solid #d7dfcd; border-radius: 4px; font: inherit; }
		.newsletter-rich-link-actions { display: flex; flex-wrap: wrap; gap: 4px; }
		.newsletter-rich-link-error { color: #9b4335; line-height: 1.5; }
	`;
	document.head.append(style);
	element.replaceChildren();
	element.classList.add('newsletter-rich-editor');
	element.classList.toggle('inline', Boolean(options.inline));
	const toolbar = document.createElement('div');
	toolbar.className = 'newsletter-rich-toolbar';
	toolbar.setAttribute('role', 'group');
	toolbar.setAttribute('aria-label', `Text formatting for ${options.label}`);
	toolbar.hidden = Boolean(options.inline);
	element.append(toolbar);
	let lastValue = value;
	let linkSelection = { from: 1, to: 1 };
	const buttons = new Map<string, HTMLButtonElement>();
	const editor = new Editor({
		element,
		extensions: [Document, Paragraph, Text, Bold, Italic, HardBreak, UndoRedo, ...(options.orderedLists ? [OrderedList, ListItem] : []), Link.extend({
			addAttributes() { return { href: { default: null } }; }
		}).configure({
			autolink: false,
			linkOnPaste: false,
			openOnClick: false,
			protocols: ['http', 'https', 'mailto', 'tel'],
			HTMLAttributes: { target: null, rel: null, class: null },
			isAllowedUri: (url) => validRichTextLink(url)
		})],
		content: richTextDocument(value),
		injectCSS: false,
		editorProps: {
			attributes: {
				...(options.id ? { id: options.id } : {}),
				class: 'newsletter-rich-content',
				role: 'textbox',
				'aria-label': options.label,
				'aria-multiline': 'true'
			},
			transformPastedHTML: (html) => {
				const template = document.createElement('template');
				template.innerHTML = html;
				for (const node of template.content.querySelectorAll('script, style, iframe, object, embed, form, input, textarea, select, button, img, svg, math, link, meta, base')) node.remove();
				for (const node of template.content.querySelectorAll('*')) {
					const href = node.tagName === 'A' ? node.getAttribute('href') : null;
					const safeHref = href && validRichTextLink(href) ? href : null;
					if (node instanceof document.defaultView!.HTMLElement) {
						for (const [active, tag] of [
							[/^(bold(er)?|[5-9]\d{2}|1000)$/.test(node.style.fontWeight), 'strong'],
							[node.style.fontStyle === 'italic' || node.style.fontStyle === 'oblique', 'em']
						] as const) {
							if (!active || !node.childNodes.length) continue;
							const mark = document.createElement(tag);
							mark.append(...node.childNodes);
							node.append(mark);
						}
					}
					for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
					if (safeHref) node.setAttribute('href', safeHref);
				}
				return template.innerHTML;
			},
			handleKeyDown: (_view, event) => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
					event.preventDefault();
					openLinkEditor();
					return true;
				}
				if (options.inline && event.key === 'Escape') {
					event.preventDefault();
					editor.view.dom.blur();
					return true;
				}
				return false;
			}
		},
		onUpdate: ({ editor: current }) => {
			lastValue = encodeRichText(current.getJSON());
			options.onUpdate(lastValue);
		},
		onTransaction: ({ editor: current }) => updateToolbar(current)
	});
	for (const action of ['bold', 'italic', 'orderedList', 'link', 'undo', 'redo'] as const) {
		if (action === 'orderedList' && !options.orderedLists) continue;
		const button = document.createElement('button');
		button.type = 'button';
		const label = action === 'orderedList' ? 'Ordered list' : action[0].toUpperCase() + action.slice(1);
		button.textContent = action === 'bold' ? 'B' : action === 'italic' ? 'I' : label;
		button.style.fontWeight = action === 'bold' ? 'bold' : '';
		button.style.fontStyle = action === 'italic' ? 'italic' : '';
		button.setAttribute('aria-label', label);
		button.title = action === 'bold' || action === 'italic' ? `${label} (Cmd/Ctrl+${action === 'bold' ? 'B' : 'I'})` : label;
		button.addEventListener('mousedown', (event) => event.preventDefault());
		button.addEventListener('click', () => {
			if (action === 'link') {
				openLinkEditor();
				return;
			}
			const chain = editor.chain().focus();
			if (action === 'bold') chain.toggleBold().run();
			else if (action === 'italic') chain.toggleItalic().run();
			else if (action === 'orderedList') chain.toggleOrderedList().run();
			else if (action === 'undo') chain.undo().run();
			else chain.redo().run();
		});
		buttons.set(action, button);
		toolbar.append(button);
	}
	const linkForm = document.createElement('div');
	linkForm.className = 'newsletter-rich-link';
	linkForm.setAttribute('role', 'group');
	linkForm.setAttribute('aria-label', 'Edit text link');
	linkForm.hidden = true;
	const linkLabel = document.createElement('label');
	linkLabel.textContent = 'Link URL';
	const linkInput = document.createElement('input');
	linkInput.type = 'text';
	linkInput.inputMode = 'url';
	linkInput.placeholder = 'https://example.com or *|UNSUB|*';
	linkLabel.append(linkInput);
	const linkError = document.createElement('p');
	linkError.className = 'newsletter-rich-link-error';
	linkError.setAttribute('role', 'alert');
	linkError.hidden = true;
	const linkActions = document.createElement('div');
	linkActions.className = 'newsletter-rich-link-actions';
	for (const action of ['Apply link', 'Remove link', 'Cancel']) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = action;
		button.addEventListener('click', () => {
			if (action === 'Apply link') applyLink();
			else {
				if (action === 'Remove link') editor.chain().setTextSelection(linkSelection).extendMarkRange('link').unsetLink().run();
				closeLinkEditor();
			}
		});
		linkActions.append(button);
	}
	linkForm.append(linkLabel, linkError, linkActions);
	toolbar.append(linkForm);
	linkForm.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLinkEditor(); }
		else if (event.key === 'Enter' && event.target === linkInput) { event.preventDefault(); applyLink(); }
	});
	function openLinkEditor() {
		const { from, to } = editor.state.selection;
		linkSelection = { from, to };
		const href = editor.getAttributes('link').href;
		linkInput.value = typeof href === 'string' ? href : '';
		linkError.hidden = true;
		linkForm.hidden = false;
		linkInput.focus();
		linkInput.select();
	}
	function closeLinkEditor() {
		editor.commands.setTextSelection(linkSelection);
		editor.view.focus();
		linkForm.hidden = true;
	}
	function applyLink() {
		const href = linkInput.value.trim();
		if (!validRichTextLink(href)) {
			linkError.textContent = 'Use http://, https://, mailto:, or tel: with a destination, or *|UNSUB|*. Web URLs cannot contain embedded credentials.';
			linkError.hidden = false;
			linkInput.focus();
			return;
		}
		const chain = editor.chain().setTextSelection(linkSelection);
		if (linkSelection.from === linkSelection.to && !editor.isActive('link')) {
			chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
			const { from, to } = editor.state.selection;
			linkSelection = { from, to };
		} else chain.extendMarkRange('link').setLink({ href }).run();
		closeLinkEditor();
	}
	function updateToolbar(current: Editor = editor) {
		for (const [action, button] of buttons) {
			if (action === 'bold' || action === 'italic' || action === 'orderedList' || action === 'link') button.setAttribute('aria-pressed', String(current.isActive(action)));
			else button.disabled = action === 'undo' ? !current.can().undo() : !current.can().redo();
		}
		current.view.dom.classList.toggle('is-empty', current.isEmpty);
	}
	function focusIn() {
		if (options.inline) toolbar.hidden = false;
		options.onFocusChange?.(true);
	}
	function focusOut(event: FocusEvent) {
		const next = event.relatedTarget;
		if (next instanceof document.defaultView!.Node && element.contains(next)) return;
		linkForm.hidden = true;
		if (options.inline) toolbar.hidden = true;
		options.onFocusChange?.(false);
	}
	function preventLinkNavigation(event: MouseEvent) {
		if (event.target instanceof document.defaultView!.Element && event.target.closest('a')) event.preventDefault();
	}
	element.addEventListener('focusin', focusIn);
	element.addEventListener('focusout', focusOut);
	element.addEventListener('click', preventLinkNavigation);
	updateToolbar();
	return {
		setEditable(editable: boolean) {
			editor.setEditable(editable, false);
		},
		setValue(next: string) {
			if (next === lastValue) return;
			editor.commands.setContent(richTextDocument(next), { emitUpdate: false });
			lastValue = next;
			updateToolbar();
		},
		destroy() {
			element.removeEventListener('focusin', focusIn);
			element.removeEventListener('focusout', focusOut);
			element.removeEventListener('click', preventLinkNavigation);
			editor.destroy();
			toolbar.remove();
			style.remove();
		}
	};
}
