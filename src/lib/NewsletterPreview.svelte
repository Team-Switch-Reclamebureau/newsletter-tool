<script lang="ts">
	import { untrack, tick, type Snippet } from 'svelte';
	import { renderMjml } from './api-client';
	import type { RenderResult } from './server/render';
	import { EMPTY_UTM, type UtmSettings } from './utm';
	import type { PreviewField } from './preview-fields';
	import { enablePreviewEditing, previewViewportHeight, type PreviewAnchor, type PreviewItemActions } from './preview-dom';

	let { source, error = '', name, utm = EMPTY_UTM, fields = [], fieldValues = {}, onUpdate, fieldEditor, itemActions, onAddItem, fillViewport = false }: {
		source: string; error?: string; name: string; utm?: UtmSettings;
		fields?: PreviewField[];
		fieldValues?: Record<string, string>;
		onUpdate?: (id: string, value: string) => void;
		fieldEditor?: Snippet<[PreviewField, string, (value: string) => void]>;
		itemActions?: PreviewItemActions;
		onAddItem?: () => void;
		fillViewport?: boolean;
	} = $props();
	let html = $state('');
	let message = $state('');
	let warnings = $state<RenderResult['errors']>([]);
	let loading = $state(false);
	let mobile = $state(false);
	let retry = $state(0);
	let version = 0;
	let editing = $state(false);
	let frame = $state<HTMLIFrameElement>();
	let panel = $state<HTMLElement>();
	let viewportHeight = $state<number>();
	let popover = $state<HTMLDivElement>();
	let selection = $state<{ id: string; left: number; top: number; value: string; update: (value: string) => void } | null>(null);
	let selectionVersion = 0;
	let trigger: HTMLElement | null = null;
	let cleanupEditing: (() => void) | undefined;
	let scrollTop = 0;
	const editable = $derived(Boolean(fieldEditor && onUpdate));
	const selected = $derived(fields.find((field) => field.id === selection?.id));

	async function selectField(id: string, anchor?: PreviewAnchor) {
		const field = fields.find((field) => field.id === id);
		if (!field || (field.type !== 'image' && field.type !== 'url' && field.type !== 'number')) return;
		if (!frame || !panel || !anchor) return;
		const frameRect = frame.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		const document = frame.contentDocument;
		const active = document?.activeElement;
		trigger = document?.defaultView && active instanceof document.defaultView.HTMLElement ? active : null;
		const current = ++selectionVersion;
		selection = {
			id,
			value: fieldValues[id] ?? '',
			update: (value) => { if (selection && current === selectionVersion) selection.value = value; },
			left: Math.max(8, Math.min(frameRect.left - panelRect.left + anchor.left, panelRect.width - 336)),
			top: Math.max(66, Math.min(frameRect.top - panelRect.top + anchor.bottom + 8, panelRect.height - 240))
		};
		await tick();
		if (selection && popover) {
			selection.top = Math.max(66, Math.min(selection.top, panel.clientHeight - popover.offsetHeight - 8));
		}
		popover?.focus();
	}

	function closeEditor(restoreFocus = true) {
		selectionVersion++;
		selection = null;
		if (restoreFocus) trigger?.focus();
	}

	function applyEditor() {
		const edit = selection;
		if (!edit) return;
		closeEditor();
		if (edit.value !== (fieldValues[edit.id] ?? '')) onUpdate?.(edit.id, edit.value);
	}

	function dismissOutside(event: MouseEvent) {
		if (selection && (!popover || !event.composedPath().includes(popover))) closeEditor(false);
	}

	function dismissOnEscape(event: KeyboardEvent) {
		if (selection && event.key === 'Escape') {
			event.preventDefault();
			closeEditor();
		}
	}

	function frameLoaded() {
		cleanupEditing?.();
		const document = frame?.contentDocument;
		if (!editable || !document || !onUpdate) return;
		frame?.contentWindow?.scrollTo(0, scrollTop);
		document.addEventListener('click', dismissOutside, true);
		document.addEventListener('keydown', dismissOnEscape, true);
		const stopEditing = enablePreviewEditing(document, fields, selectField, onUpdate, (value) => editing = value, itemActions ? {
			ids: itemActions.ids,
			onMove: (id, direction) => { selection = null; itemActions?.onMove(id, direction); },
			onRemove: (id) => { selection = null; itemActions?.onRemove(id); }
		} : undefined, fieldValues, onAddItem ? () => { closeEditor(false); editing = false; onAddItem?.(); } : undefined);
		cleanupEditing = () => {
			document.removeEventListener('click', dismissOutside, true);
			document.removeEventListener('keydown', dismissOnEscape, true);
			stopEditing();
		};
	}

	$effect(() => () => cleanupEditing?.());
	$effect(() => {
		if (!selection) return;
		document.addEventListener('click', dismissOutside, true);
		document.addEventListener('keydown', dismissOnEscape, true);
		return () => {
			document.removeEventListener('click', dismissOutside, true);
			document.removeEventListener('keydown', dismissOnEscape, true);
		};
	});
	$effect(() => { if (!editable || (selection && !selected)) selection = null; });
	$effect(() => {
		if (!fillViewport || !panel) return;
		const element = panel;
		function resize() {
			viewportHeight = previewViewportHeight(window.innerHeight, element.getBoundingClientRect().top + window.scrollY);
		}
		const observer = new ResizeObserver(resize);
		for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
			observer.observe(ancestor);
			for (let sibling = ancestor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) observer.observe(sibling);
		}
		window.addEventListener('resize', resize);
		resize();
		return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
	});

	$effect(() => {
		const mjml = source;
		const inputError = error;
		const tracking = { ...utm };
		retry;
		if (editing || selection) return;
		const current = ++version;
		if (editable) scrollTop = untrack(() => frame?.contentDocument?.documentElement.scrollTop ?? scrollTop);
		html = '';
		message = inputError;
		warnings = [];
		loading = false;
		if (!mjml || inputError) return;
		loading = true;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const rendered = await renderMjml(mjml, controller.signal, tracking);
				if (current !== version) return;
				html = rendered.html;
				warnings = rendered.errors;
			} catch (cause) {
				if (current === version && !controller.signal.aborted) message = cause instanceof Error ? cause.message : 'The preview could not be rendered.';
			} finally {
				if (current === version) loading = false;
			}
		}, 300);
		return () => { clearTimeout(timer); controller.abort(); };
	});
</script>

<section bind:this={panel} class="preview-panel" class:fill-viewport={fillViewport} style:height={fillViewport && viewportHeight !== undefined ? `${viewportHeight}px` : undefined} aria-label="Newsletter preview" aria-busy={loading}>
	<div class="toolbar"><h2>Preview</h2><div><button class:active={!mobile} aria-pressed={!mobile} onclick={() => mobile = false}>Desktop</button><button class:active={mobile} aria-pressed={mobile} onclick={() => mobile = true}>Mobile</button></div></div>
	<div class="canvas" class:mobile>
		{#if loading}<p role="status">Putting your preview together…</p>
		{:else if message}<div class="error" role="alert"><strong>Something needs a look</strong><p>{message}</p>{#if !error}<button onclick={() => retry++}>Try again</button>{/if}</div>
		{:else if html}<iframe bind:this={frame} onload={frameLoaded} title={`${name} newsletter preview`} srcdoc={html} sandbox={editable ? 'allow-same-origin' : ''} referrerpolicy="no-referrer"></iframe>
		{:else}<p>No preview available.</p>{/if}
	</div>
	{#if selected && selection && fieldEditor}
		<div bind:this={popover} class="field-popover" role="dialog" aria-label={`Edit ${selected.label}`} tabindex="-1" style:left={`${selection.left}px`} style:top={`${selection.top}px`}>
			<div class="popover-heading"><strong>{selected.type === 'image' ? 'Change image' : selected.type === 'url' ? 'Edit URL' : 'Edit number'}</strong><button onclick={applyEditor} aria-label="Close inline editor">Done</button></div>
			{#key selected.id}{@render fieldEditor(selected, selection.value, selection.update)}{/key}
		</div>
	{/if}
	{#if warnings.length}<details><summary>{warnings.length} MJML validation warnings</summary><ul>{#each warnings as warning}<li>{warning.message}</li>{/each}</ul></details>{/if}
	<div class="footer">{mobile ? '375px mobile viewport' : 'Desktop viewport'} · {editable ? 'Type in text · Use image and link icons to edit · Scripts and navigation disabled' : 'Template + newsletter content'}</div>
</section>

<style>
	.preview-panel { position: relative; border: 1px solid var(--ui-border, #dce2d4); border-radius: 9px; overflow: hidden; background: var(--ui-surface, #fcfdfb); min-width: 0; }
	.fill-viewport { box-sizing: border-box; display: flex; flex-direction: column; min-height: 320px; }
	.fill-viewport .canvas { height: auto; min-height: 0; flex: 1; }
	.fill-viewport .toolbar, .fill-viewport .footer { flex-shrink: 0; }
	.fill-viewport details { max-height: 25%; overflow-y: auto; flex-shrink: 0; }
	.field-popover { position: absolute; z-index: 2; box-sizing: border-box; width: 320px; max-width: calc(100% - 16px); max-height: min(480px, calc(100% - 82px)); overflow-y: auto; padding: 16px; border: 1px solid var(--ui-border, #dce2d4); border-radius: 8px; background: var(--ui-surface, #fcfdfb); box-shadow: 0 6px 24px #0003; }
	.popover-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
	.popover-heading button { background: var(--ui-active, #e7efdc); color: var(--ui-text, #3f5734); }
	.toolbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 17px; height: 58px; border-bottom: 1px solid var(--ui-border, #e5e9df); }
	h2 { font-size: 12px; margin: 0; }
	.toolbar > div { display: flex; padding: 3px; border: 1px solid var(--ui-border, #dfe5d6); border-radius: 5px; background: var(--ui-soft, #f2f5ec); }
	button { border: 0; border-radius: 3px; padding: 6px 9px; color: var(--ui-muted, #718161); background: transparent; font-size: 10px; }
	button.active { color: var(--ui-text, #3f5734); background: white; }
	.canvas { background: var(--ui-canvas, #e9ede4); padding: 22px; display: flex; justify-content: center; align-items: center; height: 620px; overflow-x: auto; }
	.canvas > p { color: var(--ui-muted, #78886c); font-size: 12px; }
	iframe { width: 100%; height: 100%; background: white; border: 0; }
	.mobile { justify-content: safe center; }
	.mobile iframe { width: 375px; flex-shrink: 0; }
	.error { color: #9b4335; font-size: 12px; line-height: 1.8; text-align: center; max-width: 360px; }
	.error button { border: 1px solid #d9d2c5; background: #fffdf9; }
	details { padding: 12px; background: #faf5e8; color: #8a6837; font-size: 11px; }
	summary { cursor: pointer; }
	.footer { color: var(--ui-muted, #839176); border-top: 1px solid var(--ui-border, #dce2d4); padding: 12px; font-size: 10px; }
	@media (max-width: 640px) { .canvas { padding: 12px; } }
</style>
