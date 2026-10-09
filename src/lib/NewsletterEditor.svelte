<script lang="ts">
	import { createItem, type Newsletter } from './newsletters';
	import { DEFAULT_ITEM_SNIPPET, type ImageAsset, type ImageScope } from './remote';
	import TemplateFields from './TemplateFields.svelte';
	import { templateFields } from './template-fields';

	let { newsletter, onUpdate, assets = [], onImageUpload, imageUploading = false, canUploadEditionImages = false, template = '', snippet = null }: {
		newsletter: Newsletter;
		template?: string;
		snippet?: string | null;
		onUpdate: (newsletter: Newsletter) => void;
		assets?: ImageAsset[];
		imageUploading?: boolean;
		canUploadEditionImages?: boolean;
		onImageUpload?: (newsletterId: string, itemId: string, fieldName: string, file: File, scope: ImageScope) => Promise<void>;
	} = $props();
	const newsletterSchema = $derived(templateFields(template, 'template'));
	const itemSchema = $derived(templateFields(snippet ?? DEFAULT_ITEM_SNIPPET, 'item'));

	function addItem() {
		onUpdate({ ...newsletter, items: [...newsletter.items, createItem()] });
	}

	function updateField(itemId: string, name: string, value: string) {
		onUpdate({ ...newsletter, items: newsletter.items.map((item) => item.id === itemId
			? { ...item, fields: { ...item.fields, [name]: value } } : item) });
	}

	function uploadItemImage(itemId: string, name: string, file: File, scope: ImageScope) {
		if (!onImageUpload) throw new Error('Image uploads are not available.');
		return onImageUpload(newsletter.id, itemId, name, file, scope);
	}

	function moveItem(index: number, direction: number) {
		const items = [...newsletter.items];
		const next = index + direction;
		if (next < 0 || next >= items.length) return;
		[items[index], items[next]] = [items[next], items[index]];
		onUpdate({ ...newsletter, items });
	}
</script>

<div class="newsletter-editor">
	{#if newsletterSchema.error || itemSchema.error}<p class="schema-error" role="alert">{newsletterSchema.error || itemSchema.error}</p>{/if}
	<TemplateFields fields={newsletterSchema.fields} values={newsletter.fields} prefix={newsletter.id} {assets} onUpdate={(name, value) => onUpdate({ ...newsletter, fields: { ...newsletter.fields, [name]: value } })} />
	<div class="items-heading"><h3>Items <span>{newsletter.items.length}</span></h3><button class="add" onclick={addItem}>+ Add item</button></div>
	{#if !newsletter.items.length}
		<div class="empty"><strong>What's the story?</strong><p>Add your first item and fill in the fields from your template.</p><button class="add" onclick={addItem}>+ Add your first item</button></div>
	{/if}
	{#each newsletter.items as item, index (item.id)}
		<section class="item-card" aria-label={`Item ${index + 1}`}>
			<div class="item-heading"><strong>Item {index + 1}</strong><div class="item-actions">
				<button aria-label={`Move item ${index + 1} up`} disabled={index === 0} onclick={() => moveItem(index, -1)}>↑</button>
				<button aria-label={`Move item ${index + 1} down`} disabled={index === newsletter.items.length - 1} onclick={() => moveItem(index, 1)}>↓</button>
				<button class="remove" aria-label={`Remove item ${index + 1}`} onclick={() => onUpdate({ ...newsletter, items: newsletter.items.filter((entry) => entry.id !== item.id) })}>Remove</button>
			</div></div>
			<TemplateFields fields={itemSchema.fields} values={item.fields} prefix={item.id} {assets} {imageUploading} {canUploadEditionImages} onUpdate={(name, value) => updateField(item.id, name, value)} onImageUpload={onImageUpload ? (name, file, scope) => uploadItemImage(item.id, name, file, scope) : undefined} />
		</section>
	{/each}
</div>

<style>
	.newsletter-editor { padding: 20px; max-height: 620px; overflow-y: auto; }
	.schema-error { color: #9b4335; background: #fff2ec; padding: 12px; font-size: 12px; line-height: 1.8; }
	.items-heading, .item-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	.items-heading { margin: 25px 0 15px; }
	h3 { font-size: 12px; margin: 0; }
	h3 span { color: var(--ui-muted, #81926f); margin-left: 5px; font-weight: 400; }
	.add { border: 1px solid var(--ui-border, #cbd9b9); background: var(--ui-active, #e7efdc); color: var(--ui-text, #486534); border-radius: 5px; padding: 8px 11px; font-size: 11px; }
	.empty { text-align: center; background: var(--ui-soft, #f2f5ec); padding: 30px 18px; border: 1px dashed var(--ui-border, #d4dfc8); border-radius: 7px; font-size: 12px; color: var(--ui-muted, #6d7d5e); }
	.empty p { font-size: 11px; line-height: 1.8; }
	.item-card { border: 1px solid var(--ui-border, #dce4d3); border-radius: 7px; padding: 15px; margin-bottom: 15px; background: var(--ui-surface, #f8faf4); }
	.item-heading { font-size: 11px; border-bottom: 1px solid var(--ui-border, #e2e8da); padding-bottom: 11px; }
	.item-actions { display: flex; gap: 6px; }
	.item-actions button { border: 1px solid var(--ui-border, #dbe3d1); background: white; border-radius: 4px; color: var(--ui-text, #627a4e); padding: 5px 7px; font-size: 10px; }
	.item-actions .remove { color: #9a5342; }
	@media (max-width: 1100px) { .newsletter-editor { max-height: 560px; } }
</style>
