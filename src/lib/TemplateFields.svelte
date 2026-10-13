<script lang="ts">
	import { fieldValue, type FieldValues, type TemplateField } from './template-fields';
	import type { ImageAsset } from './remote';
	import RichTextEditor from './RichTextEditor.svelte';

	let { fields, values, prefix, assets = [], onUpdate, onImageUpload, imageUploading = false, canUploadEditionImages = false }: {
		fields: TemplateField[];
		values: FieldValues | undefined;
		prefix: string;
		assets?: ImageAsset[];
		onUpdate: (name: string, value: string) => void;
		onImageUpload?: (name: string, file: File) => Promise<void>;
		imageUploading?: boolean;
		canUploadEditionImages?: boolean;
	} = $props();
	let uploading = $state<string | null>(null);
	let uploadError = $state('');

	async function uploadImage(name: string, input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file || !onImageUpload) return;
		uploadError = '';
		uploading = name;
		try {
			if (!canUploadEditionImages) throw new Error('Save this campaign before uploading campaign images.');
			await onImageUpload(name, file);
		}
		catch (cause) { uploadError = cause instanceof Error ? cause.message : 'The image could not be uploaded.'; }
		finally { uploading = null; input.value = ''; }
	}
</script>

{#if onImageUpload && !canUploadEditionImages && fields.some((field) => field.type === 'image')}
	<p class="image-hint">Save this campaign before uploading campaign images.</p>
{/if}
{#if uploadError}<p class="upload-error" role="alert">{uploadError}</p>{/if}
{#each fields as field (field.name)}
	<label for={`${prefix}-field-${field.name}`}>{field.name.replace(/[_-]/g, ' ')} <small>{field.type}</small></label>
	{#if field.type === 'textarea'}
		<RichTextEditor id={`${prefix}-field-${field.name}`} label={field.name.replace(/[_-]/g, ' ')} value={fieldValue(values, field.name)} onUpdate={(value) => onUpdate(field.name, value)} />
	{:else}
		<input id={`${prefix}-field-${field.name}`} type={field.type === 'image' ? 'url' : field.type === 'text' ? 'text' : field.type} step={field.type === 'number' ? 'any' : undefined} value={fieldValue(values, field.name)} oninput={(event) => onUpdate(field.name, event.currentTarget.value)} />
	{/if}
	{#if field.type === 'image'}
		<label for={`${prefix}-field-${field.name}-asset`}>Uploaded image for {field.name.replace(/[_-]/g, ' ')}</label>
		<select id={`${prefix}-field-${field.name}-asset`} disabled={!assets.length} aria-describedby={!assets.length ? `${prefix}-field-${field.name}-hint` : undefined} value={assets.some((asset) => asset.url === fieldValue(values, field.name)) ? fieldValue(values, field.name) : ''} onchange={(event) => onUpdate(field.name, event.currentTarget.value)}>
			<option value="">{assets.length ? 'No uploaded image selected' : 'No uploaded images yet'}</option>
			{#each ['project', 'edition'] as scope}
				<optgroup label={scope === 'project' ? 'Project images' : 'Campaign images'}>
					{#each assets.filter((asset) => asset.scope === scope) as asset (asset.id)}<option value={asset.url}>{asset.filename}</option>{/each}
				</optgroup>
			{/each}
		</select>
		{#if !assets.length}
			<p class="image-hint" id={`${prefix}-field-${field.name}-hint`}>Upload an image in the Campaign images tab to select it here, or enter an image URL above.</p>
		{/if}
		{#if onImageUpload}
			<label for={`${prefix}-field-${field.name}-upload`}>{uploading === field.name ? 'Uploading image...' : `Upload an image for ${field.name.replace(/[_-]/g, ' ')}`}</label>
			<input id={`${prefix}-field-${field.name}-upload`} type="file" accept="image/jpeg,image/png,image/webp" disabled={imageUploading || uploading !== null || !canUploadEditionImages} onchange={(event) => uploadImage(field.name, event.currentTarget)} />
		{/if}
	{/if}
{/each}

<style>
	label { display: block; font-size: 11px; font-weight: 600; color: var(--ui-text, #5c7050); margin: 15px 0 7px; }
	label small { font-weight: 400; color: var(--ui-muted, #7c8772); margin-left: 5px; }
	input, select { width: 100%; border: 1px solid var(--ui-border, #d7dfcd); background: white; border-radius: 5px; padding: 10px 11px; font: inherit; font-size: 12px; color: var(--ui-text, #34492c); }
	.image-hint { font-size: 11px; color: var(--ui-muted, #7c8772); line-height: 1.7; }
	.upload-error { color: #9b4335; background: #fff2ec; padding: 12px; font-size: 12px; line-height: 1.8; }
	input:focus-visible, select:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 2px; }
</style>
