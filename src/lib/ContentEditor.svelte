<script lang="ts">
	import NewsletterEditor from './NewsletterEditor.svelte';
	import NewsletterPreview from './NewsletterPreview.svelte';
	import TemplateFields from './TemplateFields.svelte';
	import { composeNewsletter, createItem, moveNewsletterItem, type Newsletter } from './newsletters';
	import { previewFields, previewFieldValue, updatePreviewField, type PreviewField } from './preview-fields';
	import type { ImageAsset, ImageScope } from './remote';
	import type { EditorLayout } from './user-preferences';

	let { newsletter, template, snippet, assets, canUploadEditionImages, imageUploading, onUpdate, onImageUpload, layout, layoutSaving = false, onLayoutChange }: {
		newsletter: Newsletter;
		template: string;
		snippet: string | null;
		assets: ImageAsset[];
		canUploadEditionImages: boolean;
		imageUploading: boolean;
		onUpdate: (newsletter: Newsletter) => void;
		onImageUpload: (newsletterId: string, itemId: string, fieldName: string, file: File, scope: ImageScope) => Promise<void>;
		layout: EditorLayout;
		layoutSaving?: boolean;
		onLayoutChange: (layout: EditorLayout) => void;
	} = $props();
	let showAll = $state(false);
	const fields = $derived(previewFields(template, snippet, newsletter));
	const composition = $derived(composeNewsletter(template, snippet, newsletter, layout === 'dynamic' ? fields : undefined));

	function update(id: string, value: string) {
		const field = fields.find((field) => field.id === id);
		if (!field) throw new Error('The selected preview field no longer exists.');
		onUpdate(updatePreviewField(newsletter, field, value));
	}

	function uploadSelectedImage(itemId: string | null, name: string, file: File, scope: ImageScope) {
		if (itemId === null) throw new Error('Choose an item image field before uploading.');
		return onImageUpload(newsletter.id, itemId, name, file, scope);
	}
</script>

<div class="mode-toolbar">
	<div class="mode-switch" aria-label="Content editor layout">
		<button class:active={layout === 'split'} aria-pressed={layout === 'split'} disabled={layoutSaving} onclick={() => onLayoutChange('split')}>Split</button>
		<button class:active={layout === 'dynamic'} aria-pressed={layout === 'dynamic'} disabled={layoutSaving} onclick={() => onLayoutChange('dynamic')}>Dynamic</button>
	</div>
	<p>{layout === 'split' ? 'Edit fields alongside the live preview.' : 'Type directly into preview text. Use image and link icons to edit inline.'}</p>
	{#if layout === 'dynamic'}<button class="all-fields" aria-pressed={showAll} onclick={() => showAll = !showAll}>{showAll ? 'Hide fields & items' : 'All fields & items'}</button>{/if}
	{#if layoutSaving}<span role="status">Saving your layout...</span>{/if}
</div>
<div class="content-grid" class:dynamic={layout === 'dynamic'}>
	{#if layout === 'split' || showAll}
	<section class="editor-panel" aria-label="Newsletter content">
		<div class="panel-toolbar">
			<h2>Newsletter content</h2>
		</div>
			<NewsletterEditor {newsletter} {template} {snippet} {assets} {canUploadEditionImages} {imageUploading} {onUpdate} {onImageUpload} />
	</section>
	{/if}
	<div class="preview">
		<NewsletterPreview source={composition.source} error={composition.error ?? ''} name={newsletter.name} utm={newsletter.utm} fields={layout === 'dynamic' ? fields : []} onUpdate={layout === 'dynamic' ? update : undefined} fieldEditor={layout === 'dynamic' ? inlineEditor : undefined} onAddItem={layout === 'dynamic' ? () => onUpdate({ ...newsletter, items: [...newsletter.items, createItem()] }) : undefined} itemActions={layout === 'dynamic' ? {
			ids: newsletter.items.map((item) => item.id),
			onMove: (id, direction) => onUpdate(moveNewsletterItem(newsletter, id, direction)),
			onRemove: (id) => onUpdate({ ...newsletter, items: newsletter.items.filter((item) => item.id !== id) })
		} : undefined} />
		{#snippet inlineEditor(selected: PreviewField)}
			<TemplateFields fields={[selected]} values={{ [selected.name]: previewFieldValue(newsletter, selected) }} prefix="dynamic" {assets} {imageUploading} {canUploadEditionImages} onUpdate={(_name, value) => update(selected.id, value)} onImageUpload={selected.itemId !== null ? (name, file, scope) => uploadSelectedImage(selected.itemId, name, file, scope) : undefined} />
			{#if selected.type === 'image' && selected.itemId === null}<p>Upload new campaign-level images in the Images tabs, then select them here.</p>{/if}
		{/snippet}
	</div>
</div>

<style>
	.mode-toolbar { display: flex; flex-wrap: wrap; gap: 15px; align-items: center; margin-bottom: 15px; }
	.mode-switch { display: flex; gap: 3px; padding: 3px; background: var(--ui-soft, #f2f5ec); border: 1px solid var(--ui-border, #dce2d4); border-radius: 6px; }
	button { border: 0; border-radius: 4px; padding: 8px 12px; color: var(--ui-muted, #718161); background: transparent; font-size: 11px; }
	button.active { background: white; color: var(--ui-text, #3f5734); }
	p { font-size: 11px; color: var(--ui-muted, #718161); line-height: 1.7; }
	.mode-toolbar > span { font-size: 11px; color: var(--ui-muted, #718161); }
	.content-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px; align-items: start; }
	.dynamic { grid-template-columns: minmax(0, 1fr); }
	.dynamic .preview { grid-row: 1; }
	.editor-panel { min-width: 0; border: 1px solid var(--ui-border, #dce2d4); border-radius: 12px; box-shadow: var(--ui-shadow); background: var(--ui-surface, #fcfdfb); overflow: hidden; }
	.panel-toolbar { display: flex; justify-content: space-between; align-items: center; height: 58px; padding: 14px 18px; border-bottom: 1px solid var(--ui-border, #e1e8d8); }
	h2 { font-size: 12px; margin: 0; }
	.all-fields { padding: 6px; background: var(--ui-soft, #f2f5ec); }
	.preview { min-width: 0; }
	@media (max-width: 1100px) { .content-grid { grid-template-columns: minmax(0, 1fr); } .dynamic .preview { grid-row: 1; } }
</style>
