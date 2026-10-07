<script lang="ts">
	import { createItem, type Newsletter, type NewsletterItem } from './newsletters';
	import type { ImageAsset, ImageScope } from './remote';
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
		onImageUpload?: (newsletterId: string, itemId: string, file: File, scope: ImageScope) => Promise<void>;
	} = $props();
	let uploadError = $state('');
	let uploading = $state<string | null>(null);
	let uploadScope = $state<ImageScope>('project');
	const newsletterSchema = $derived(templateFields(template, 'template'));
	const itemSchema = $derived(templateFields(snippet ?? '{{image}}{{image_alt}}{{title}}{{text}}{{button}}{{url}}', 'item'));
	const legacyFields = $derived.by(() => {
		const names = new Set(itemSchema.fields.filter((field) => !field.typed).map((field) => field.name));
		if (!itemSchema.error && !itemSchema.fields.some((field) => field.typed)) {
			for (const name of ['image', 'image_alt', 'title', 'text', 'button', 'url']) names.add(name);
		}
		if (names.has('button') || names.has('url')) { names.add('button'); names.add('url'); }
		return names;
	});

	function addItem() {
		const item = createItem();
		if (itemSchema.fields.some((field) => field.typed)) item.fields = {};
		onUpdate({ ...newsletter, items: [...newsletter.items, item] });
	}

	function updateField(itemId: string, name: string, value: string) {
		onUpdate({ ...newsletter, items: newsletter.items.map((item) => item.id === itemId
			? { ...item, fields: { ...item.fields, [name]: value } } : item) });
	}

	function updateItem(id: string, field: keyof Omit<NewsletterItem, 'id' | 'fields'>, value: string) {
		onUpdate({ ...newsletter, items: newsletter.items.map((item) => item.id === id
			? { ...item, [field]: value, ...(field === 'image' ? { imageAssetId: undefined } : {}),
				...(field === 'imageAlt' && !value ? { imageAlt: undefined } : {}) } : item) });
	}

	function chooseImage(id: string, assetId: string) {
		const asset = assets.find((asset) => asset.id === assetId);
		onUpdate({ ...newsletter, items: newsletter.items.map((item) => item.id === id
			? { ...item, imageAssetId: asset?.id, image: asset?.url ?? '' } : item) });
	}

	async function uploadImage(itemId: string, input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file || !onImageUpload) return;
		uploadError = '';
		uploading = itemId;
		try { await onImageUpload(newsletter.id, itemId, file, uploadScope); }
		catch (error) { uploadError = error instanceof Error ? error.message : 'The image could not be uploaded.'; }
		finally { uploading = null; input.value = ''; }
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
	<label class="name-field" for="newsletter-name">Newsletter name</label>
	<input id="newsletter-name" value={newsletter.name} oninput={(event) => onUpdate({ ...newsletter, name: event.currentTarget.value })} maxlength="160" required />
	{#if newsletterSchema.error || itemSchema.error}<p class="upload-error" role="alert">{newsletterSchema.error || itemSchema.error}</p>{/if}
	<TemplateFields fields={newsletterSchema.fields} values={newsletter.fields} prefix={newsletter.id} {assets} onUpdate={(name, value) => onUpdate({ ...newsletter, fields: { ...newsletter.fields, [name]: value } })} />
	{#if onImageUpload && legacyFields.has('image')}
		<label for={`${newsletter.id}-upload-scope`}>Upload new item images to</label>
		<select id={`${newsletter.id}-upload-scope`} bind:value={uploadScope} disabled={imageUploading}>
			<option value="project">Project (available in every edition)</option>
			<option value="edition" disabled={!canUploadEditionImages}>This edition{canUploadEditionImages ? '' : ' (save first)'}</option>
		</select>
	{/if}
	<div class="items-heading"><h3>Items <span>{newsletter.items.length}</span></h3><button class="add" onclick={addItem}>+ Add item</button></div>
	{#if uploadError}<p class="upload-error" role="alert">{uploadError}</p>{/if}
	{#if !newsletter.items.length}
		<div class="empty"><strong>What’s the story?</strong><p>Add your first item and fill in the fields from your template.</p><button class="add" onclick={addItem}>+ Add your first item</button></div>
	{/if}
	{#each newsletter.items as item, index (item.id)}
		<section class="item-card" aria-label={`Item ${index + 1}`}>
			<div class="item-heading"><strong>Item {index + 1}</strong><div class="item-actions">
				<button aria-label={`Move item ${index + 1} up`} disabled={index === 0} onclick={() => moveItem(index, -1)}>↑</button>
				<button aria-label={`Move item ${index + 1} down`} disabled={index === newsletter.items.length - 1} onclick={() => moveItem(index, 1)}>↓</button>
				<button class="remove" aria-label={`Remove item ${index + 1}`} onclick={() => onUpdate({ ...newsletter, items: newsletter.items.filter((entry) => entry.id !== item.id) })}>Remove</button>
			</div></div>
			<TemplateFields fields={itemSchema.fields} values={item.fields} prefix={item.id} {assets} onUpdate={(name, value) => updateField(item.id, name, value)} />
			{#if onImageUpload && legacyFields.has('image')}
				<label for={`${item.id}-asset`}>Uploaded image</label>
				<select id={`${item.id}-asset`} value={item.imageAssetId ?? ''} onchange={(event) => chooseImage(item.id, event.currentTarget.value)}>
					<option value="">No uploaded image selected</option>
					{#each ['project', 'edition'] as scope}
						<optgroup label={scope === 'project' ? 'Project images' : 'Edition images'}>
							{#each assets.filter((asset) => asset.scope === scope) as asset (asset.id)}<option value={asset.id}>{asset.filename} ({asset.width} × {asset.height})</option>{/each}
						</optgroup>
					{/each}
				</select>
				<label class="upload-label" for={`${item.id}-upload`}>{uploading === item.id ? 'Uploading image…' : 'Upload a new image'}</label>
				<input id={`${item.id}-upload`} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null || imageUploading || (uploadScope === 'edition' && !canUploadEditionImages)} onchange={(event) => uploadImage(item.id, event.currentTarget)} />
			{/if}
			{#if legacyFields.has('image')}
			<label for={`${item.id}-image`}>Image URL <small>optional</small></label>
			<input id={`${item.id}-image`} type="url" placeholder="https://example.com/image.jpg" value={item.image} oninput={(event) => updateItem(item.id, 'image', event.currentTarget.value)} />
			{/if}
			{#if legacyFields.has('image_alt')}
			<label for={`${item.id}-alt`}>Image alt text <small>defaults to title</small></label>
			<input id={`${item.id}-alt`} value={item.imageAlt ?? ''} oninput={(event) => updateItem(item.id, 'imageAlt', event.currentTarget.value)} />
			{/if}
			{#if legacyFields.has('title')}
			<label for={`${item.id}-title`}>Title</label>
			<input id={`${item.id}-title`} value={item.title} oninput={(event) => updateItem(item.id, 'title', event.currentTarget.value)} required />
			{/if}
			{#if legacyFields.has('text')}
			<label for={`${item.id}-text`}>Text content</label>
			<textarea id={`${item.id}-text`} rows="4" placeholder="Tell your readers something good…" value={item.text} oninput={(event) => updateItem(item.id, 'text', event.currentTarget.value)}></textarea>
			{/if}
			{#if legacyFields.has('button')}
			<label for={`${item.id}-button`}>Button label <small>optional</small></label>
			<input id={`${item.id}-button`} placeholder="Read more" value={item.button} oninput={(event) => updateItem(item.id, 'button', event.currentTarget.value)} />
			{/if}
			{#if legacyFields.has('url')}
			<label for={`${item.id}-url`}>Button URL</label>
			<input id={`${item.id}-url`} type="url" placeholder="https://example.com/article" value={item.url} oninput={(event) => updateItem(item.id, 'url', event.currentTarget.value)} />
			{/if}
		</section>
	{/each}
</div>

<style>
	.newsletter-editor { padding: 20px; max-height: 620px; overflow-y: auto; }
	label { display: block; font-size: 11px; font-weight: 600; color: var(--ui-text, #5c7050); margin: 15px 0 7px; }
	.name-field { margin-top: 0; }
	label small { font-weight: 400; color: var(--ui-muted, #7c8772); margin-left: 5px; }
	input, textarea, select { width: 100%; border: 1px solid var(--ui-border, #d7dfcd); background: white; border-radius: 5px; padding: 10px 11px; font: inherit; font-size: 12px; color: var(--ui-text, #34492c); }
	.upload-error { color: #9b4335; background: #fff2ec; padding: 12px; font-size: 12px; line-height: 1.8; }
	.upload-label { color: var(--ui-text, #6d824f); }
	textarea { resize: vertical; line-height: 1.7; min-height: 85px; }
	input:focus-visible, textarea:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 2px; }
	input::placeholder, textarea::placeholder { color: var(--ui-muted, #929c87); }
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
