<script lang="ts">
	import { untrack } from 'svelte';
	import { renderMjml } from './api-client';
	import type { RenderResult } from './server/render';
	import { EMPTY_UTM, type UtmSettings } from './utm';
	import type { PreviewField } from './preview-fields';
	import { enablePreviewEditing } from './preview-dom';

	let { source, error = '', name, utm = EMPTY_UTM, fields = [], onSelect, onUpdate }: {
		source: string; error?: string; name: string; utm?: UtmSettings;
		fields?: PreviewField[];
		onSelect?: (id: string) => void;
		onUpdate?: (id: string, value: string) => void;
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
	let cleanupEditing: (() => void) | undefined;
	let scrollTop = 0;
	const editable = $derived(Boolean(onSelect && onUpdate));

	function frameLoaded() {
		cleanupEditing?.();
		const document = frame?.contentDocument;
		if (!editable || !document || !onSelect || !onUpdate) return;
		frame?.contentWindow?.scrollTo(0, scrollTop);
		cleanupEditing = enablePreviewEditing(document, fields, onSelect, onUpdate, (value) => editing = value);
	}

	$effect(() => () => cleanupEditing?.());

	$effect(() => {
		const mjml = source;
		const inputError = error;
		const tracking = { ...utm };
		retry;
		if (editing) return;
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

<section class="preview-panel" aria-label="Newsletter preview" aria-busy={loading}>
	<div class="toolbar"><h2>Preview</h2><div><button class:active={!mobile} aria-pressed={!mobile} onclick={() => mobile = false}>Desktop</button><button class:active={mobile} aria-pressed={mobile} onclick={() => mobile = true}>Mobile</button></div></div>
	<div class="canvas" class:mobile>
		{#if loading}<p role="status">Putting your preview together…</p>
		{:else if message}<div class="error" role="alert"><strong>Something needs a look</strong><p>{message}</p>{#if !error}<button onclick={() => retry++}>Try again</button>{/if}</div>
		{:else if html}<iframe bind:this={frame} onload={frameLoaded} title={`${name} newsletter preview`} srcdoc={html} sandbox={editable ? 'allow-same-origin' : ''} referrerpolicy="no-referrer"></iframe>
		{:else}<p>No preview available.</p>{/if}
	</div>
	{#if warnings.length}<details><summary>{warnings.length} MJML validation warnings</summary><ul>{#each warnings as warning}<li>{warning.message}</li>{/each}</ul></details>{/if}
	<div class="footer">{mobile ? '375px mobile viewport' : 'Desktop viewport'} · {editable ? 'Type in text · Click images and links to edit · Scripts and navigation disabled' : 'Template + newsletter content'}</div>
</section>

<style>
	.preview-panel { border: 1px solid var(--ui-border, #dce2d4); border-radius: 9px; overflow: hidden; background: var(--ui-surface, #fcfdfb); min-width: 0; }
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
