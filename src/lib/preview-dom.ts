import { previewItemClass, type PreviewField } from './preview-fields';
import { createRichTextEditor } from './rich-text-editor';

export interface PreviewAnchor {
	left: number;
	bottom: number;
}

export interface PreviewItemActions {
	ids: string[];
	onMove: (id: string, direction: -1 | 1) => void;
	onRemove: (id: string) => void;
}

export function previewViewportHeight(viewportHeight: number, documentTop: number): number {
	return Math.max(320, Math.floor(viewportHeight - documentTop - 16));
}

export function previewText(element: { innerText: string }): string {
	const text = element.innerText.replace(/\r\n/g, '\n');
	// Plaintext editing adds a final line break for caret positioning.
	return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function enablePreviewEditing(
	document: Document,
	fields: PreviewField[],
	onSelect: (id: string, anchor?: PreviewAnchor) => void,
	onUpdate: (id: string, value: string) => void,
	onEditing: (editing: boolean) => void,
	itemActions?: PreviewItemActions,
	fieldValues: Record<string, string> = {}
): () => void {
	const controller = new AbortController();
	const options = { signal: controller.signal };
	const richEditors: ReturnType<typeof createRichTextEditor>[] = [];
	const style = document.createElement('style');
	style.textContent = `
		[data-newsletter-field] { cursor: text; min-width: 1ch; display: inline-block; white-space: pre-wrap; }
		[data-newsletter-field]:empty::before { content: "Edit text"; opacity: .45; }
		[data-newsletter-field]:hover, [data-newsletter-field]:focus { outline: 2px solid #829e66; outline-offset: 3px; }
		.newsletter-edit-target { cursor: pointer; }
		.newsletter-edit-target:hover { outline: 2px dashed #829e66; outline-offset: -2px; }
		.newsletter-edit-tools { position: absolute; z-index: 1000; display: flex; gap: 4px; padding: 4px; border-radius: 6px; background: #fff; box-shadow: 0 2px 8px #0003; }
		.newsletter-edit-tools button { display: grid; place-items: center; width: 30px; height: 30px; padding: 5px; border: 1px solid #dce2d4; border-radius: 4px; background: #fff; color: #3f5734; cursor: pointer; }
		.newsletter-edit-tools button:hover { background: #e7efdc; }
		.newsletter-edit-tools button:focus-visible { outline: 2px solid #829e66; outline-offset: 2px; }
		.newsletter-edit-tools button:disabled { opacity: .35; cursor: default; }
	`;
	document.head.append(style);
	for (const control of document.querySelectorAll<HTMLInputElement>('input, textarea, select, button')) control.disabled = true;
	const targets = new Map<HTMLElement, PreviewField[]>();
	function select(field: PreviewField, element: HTMLElement) {
		if (field.type === 'image' || field.type === 'url') element.focus({ preventScroll: true });
		const rect = element.getBoundingClientRect();
		onSelect(field.id, { left: rect.left, bottom: rect.bottom });
	}
	for (const field of fields) {
		for (const element of document.querySelectorAll<HTMLElement>(`.${field.id}`)) {
			const current = targets.get(element) ?? [];
			current.push(field);
			targets.set(element, current);
		}
		for (const element of document.querySelectorAll<HTMLElement>(`[data-newsletter-field="${field.id}"]`)) {
			element.tabIndex = 0;
			element.setAttribute('aria-label', `Edit ${field.label}`);
			if (field.type === 'textarea') {
				if (!Object.hasOwn(fieldValues, field.id)) throw new Error(`Missing preview value for ${field.label}.`);
				element.removeAttribute('tabindex');
				richEditors.push(createRichTextEditor(element, fieldValues[field.id], {
					label: `Edit ${field.label}`,
					inline: true,
					onUpdate: (value) => onUpdate(field.id, value),
					onFocusChange: onEditing
				}));
				continue;
			}
			const inline = field.type === 'text';
			if (!inline) {
				element.addEventListener('focus', () => select(field, element), options);
				continue;
			}
			for (const br of element.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
			element.normalize();
			element.contentEditable = 'plaintext-only';
			element.setAttribute('role', 'textbox');
			element.setAttribute('aria-multiline', 'false');
			element.addEventListener('focus', () => { onEditing(true); onSelect(field.id); }, options);
			element.addEventListener('input', () => onUpdate(field.id, previewText(element)), options);
			element.addEventListener('blur', () => onEditing(false), options);
			element.addEventListener('keydown', (event) => {
				if (event.key === 'Escape' || event.key === 'Enter') {
					event.preventDefault();
					element.blur();
				}
			}, options);
		}
	}
	const tools: { container: HTMLElement; targets: HTMLElement[]; side: 'left' | 'right' }[] = [];
	for (const [element, mapped] of targets) {
		const editable = mapped.filter((field) => field.type === 'image' || field.type === 'url');
		if (!editable.length) continue;
		const field = editable.find((field) => field.type === 'image') ?? editable[0];
		element.classList.add('newsletter-edit-target');
		element.dataset.newsletterTarget = field.id;
		element.tabIndex = 0;
		element.setAttribute('role', 'button');
		element.setAttribute('aria-label', `Edit ${field.label}`);
		element.addEventListener('keydown', (event) => {
			if (event.target !== element || !['Enter', ' '].includes(event.key)) return;
			event.preventDefault();
			select(field, element);
		}, options);
		const container = document.createElement('div');
		container.className = 'newsletter-edit-tools';
		for (const field of editable) {
			const button = document.createElement('button');
			button.type = 'button';
			button.setAttribute('aria-label', `${field.type === 'image' ? 'Change image' : 'Edit URL'}: ${field.label}`);
			button.title = button.getAttribute('aria-label')!;
			button.innerHTML = field.type === 'image'
				? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>'
				: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></svg>';
			button.addEventListener('click', () => select(field, button), options);
			container.append(button);
		}
		document.body.append(container);
		tools.push({ container, targets: [element.querySelector<HTMLElement>('img') ?? element], side: 'right' });
	}
	for (const [index, id] of (itemActions?.ids ?? []).entries()) {
		const targets = [...document.querySelectorAll<HTMLElement>(`.${previewItemClass(id)}`)];
		if (!targets.length || !itemActions) continue;
		const container = document.createElement('div');
		container.className = 'newsletter-edit-tools';
		container.setAttribute('role', 'group');
		container.setAttribute('aria-label', `Item ${index + 1} controls`);
		for (const action of ['up', 'down', 'remove'] as const) {
			const button = document.createElement('button');
			button.type = 'button';
			button.title = action === 'remove' ? `Remove item ${index + 1}` : `Move item ${index + 1} ${action}`;
			button.setAttribute('aria-label', button.title);
			button.disabled = action === 'up' ? index === 0 : action === 'down' ? index === itemActions.ids.length - 1 : false;
			button.innerHTML = action === 'remove'
				? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>'
				: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="${action === 'up' ? 'm6 12 6-6 6 6M12 6v13' : 'm6 12 6 6 6-6M12 18V5'}"/></svg>`;
			button.addEventListener('click', () => {
				onEditing(false);
				if (action === 'remove') itemActions.onRemove(id);
				else itemActions.onMove(id, action === 'up' ? -1 : 1);
			}, options);
			container.append(button);
		}
		document.body.append(container);
		tools.push({ container, targets, side: 'left' });
	}
	function positionTools() {
		for (const { container, targets, side } of tools) {
			const rects = targets.map((target) => target.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
			container.hidden = !rects.length;
			container.style.display = container.hidden ? 'none' : 'flex';
			if (!rects.length) continue;
			const left = side === 'left' ? Math.min(...rects.map((rect) => rect.left)) + 6 : Math.max(...rects.map((rect) => rect.right)) - container.offsetWidth - 6;
			container.style.left = `${Math.max(0, left + (document.defaultView?.scrollX ?? 0))}px`;
			container.style.top = `${Math.min(...rects.map((rect) => rect.top)) + (document.defaultView?.scrollY ?? 0) + 6}px`;
		}
	}
	const observer = new document.defaultView!.ResizeObserver(positionTools);
	observer.observe(document.body);
	for (const { targets } of tools) for (const target of targets) observer.observe(target);
	document.defaultView!.addEventListener('resize', positionTools, options);
	document.addEventListener('load', positionTools, { ...options, capture: true });
	positionTools();
	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof document.defaultView!.Element)) return;
		if (target.closest('.newsletter-rich-editor')) {
			if (target.closest('a')) event.preventDefault();
			return;
		}
		event.preventDefault();
		const inline = target.closest('[data-newsletter-field]')?.getAttribute('data-newsletter-field');
		const wrapper = target.closest('[data-newsletter-target]')?.getAttribute('data-newsletter-target');
		const field = fields.find((field) => field.id === inline)
			?? fields.find((field) => field.id === wrapper);
		if (field) {
			const element = target.closest<HTMLElement>('[data-newsletter-field], [data-newsletter-target]');
			if (element) select(field, element);
		}
	}, { ...options, capture: true });
	document.addEventListener('submit', (event) => event.preventDefault(), options);
	return () => {
		controller.abort();
		for (const editor of richEditors) editor.destroy();
		observer.disconnect();
		for (const { container } of tools) container.remove();
		style.remove();
	};
}
