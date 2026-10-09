import type { PreviewField } from './preview-fields';

export function previewText(element: { innerText: string }): string {
	const text = element.innerText.replace(/\r\n/g, '\n');
	// Plaintext editing adds a final line break for caret positioning.
	return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function enablePreviewEditing(
	document: Document,
	fields: PreviewField[],
	onSelect: (id: string) => void,
	onUpdate: (id: string, value: string) => void,
	onEditing: (editing: boolean) => void
): () => void {
	const controller = new AbortController();
	const options = { signal: controller.signal };
	const style = document.createElement('style');
	style.textContent = `
		[data-newsletter-field] { cursor: text; min-width: 1ch; display: inline-block; white-space: pre-wrap; }
		[data-newsletter-field]:empty::before { content: "Edit text"; opacity: .45; }
		[data-newsletter-field]:hover, [data-newsletter-field]:focus { outline: 2px solid #829e66; outline-offset: 3px; }
		.newsletter-edit-target { cursor: pointer; }
		.newsletter-edit-target:hover { outline: 2px dashed #829e66; outline-offset: -2px; }
	`;
	document.head.append(style);
	const targets = new Map<HTMLElement, PreviewField>();
	for (const field of fields) {
		for (const element of document.querySelectorAll<HTMLElement>(`.${field.id}`)) {
			const current = targets.get(element);
			if (!current || field.type === 'image' || (field.type === 'url' && current.type !== 'image')) targets.set(element, field);
		}
		for (const element of document.querySelectorAll<HTMLElement>(`[data-newsletter-field="${field.id}"]`)) {
			element.tabIndex = 0;
			element.setAttribute('aria-label', `Edit ${field.label}`);
			const inline = field.type === 'text' || field.type === 'textarea';
			if (!inline) {
				element.addEventListener('focus', () => onSelect(field.id), options);
				continue;
			}
			for (const br of element.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
			element.normalize();
			element.contentEditable = 'plaintext-only';
			element.setAttribute('role', 'textbox');
			element.setAttribute('aria-multiline', String(field.type === 'textarea'));
			element.addEventListener('focus', () => { onEditing(true); onSelect(field.id); }, options);
			element.addEventListener('input', () => onUpdate(field.id, previewText(element)), options);
			element.addEventListener('blur', () => onEditing(false), options);
			element.addEventListener('keydown', (event) => {
				if (event.key === 'Escape' || (event.key === 'Enter' && field.type !== 'textarea')) {
					event.preventDefault();
					element.blur();
				}
			}, options);
		}
	}
	for (const [element, field] of targets) {
		element.classList.add('newsletter-edit-target');
		element.dataset.newsletterTarget = field.id;
		element.tabIndex = 0;
		element.setAttribute('role', 'button');
		element.setAttribute('aria-label', `Edit ${field.label}`);
		element.addEventListener('keydown', (event) => {
			if (event.target !== element || !['Enter', ' '].includes(event.key)) return;
			event.preventDefault();
			onSelect(field.id);
		}, options);
	}
	document.addEventListener('click', (event) => {
		event.preventDefault();
		const target = event.target;
		if (!(target instanceof document.defaultView!.Element)) return;
		const inline = target.closest('[data-newsletter-field]')?.getAttribute('data-newsletter-field');
		const wrapper = target.closest('[data-newsletter-target]')?.getAttribute('data-newsletter-target');
		const field = fields.find((field) => field.id === inline)
			?? fields.find((field) => field.id === wrapper);
		if (field) onSelect(field.id);
	}, { ...options, capture: true });
	document.addEventListener('submit', (event) => event.preventDefault(), options);
	for (const control of document.querySelectorAll<HTMLInputElement>('input, textarea, select, button')) control.disabled = true;
	return () => { controller.abort(); style.remove(); };
}
