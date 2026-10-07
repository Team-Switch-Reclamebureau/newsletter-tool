<script lang="ts">
	import { fieldValue, type FieldValues, type TemplateField } from './template-fields';
	import type { ImageAsset } from './remote';

	let { fields, values, prefix, assets = [], onUpdate }: {
		fields: TemplateField[];
		values: FieldValues | undefined;
		prefix: string;
		assets?: ImageAsset[];
		onUpdate: (name: string, value: string) => void;
	} = $props();
</script>

{#each fields.filter((field) => field.typed) as field (field.name)}
	<label for={`${prefix}-field-${field.name}`}>{field.name.replace(/[_-]/g, ' ')} <small>{field.type}</small></label>
	{#if field.type === 'textarea'}
		<textarea id={`${prefix}-field-${field.name}`} rows="4" value={fieldValue(values, field.name)} oninput={(event) => onUpdate(field.name, event.currentTarget.value)}></textarea>
	{:else}
		<input id={`${prefix}-field-${field.name}`} type={field.type === 'image' ? 'url' : field.type === 'text' ? 'text' : field.type} step={field.type === 'number' ? 'any' : undefined} value={fieldValue(values, field.name)} oninput={(event) => onUpdate(field.name, event.currentTarget.value)} />
	{/if}
	{#if field.type === 'image'}
		<label for={`${prefix}-field-${field.name}-asset`}>Uploaded image for {field.name.replace(/[_-]/g, ' ')}</label>
		<select id={`${prefix}-field-${field.name}-asset`} disabled={!assets.length} aria-describedby={!assets.length ? `${prefix}-field-${field.name}-hint` : undefined} value={assets.some((asset) => asset.url === fieldValue(values, field.name)) ? fieldValue(values, field.name) : ''} onchange={(event) => onUpdate(field.name, event.currentTarget.value)}>
			<option value="">{assets.length ? 'No uploaded image selected' : 'No uploaded images yet'}</option>
			{#each ['project', 'edition'] as scope}
				<optgroup label={scope === 'project' ? 'Project images' : 'Edition images'}>
					{#each assets.filter((asset) => asset.scope === scope) as asset (asset.id)}<option value={asset.url}>{asset.filename}</option>{/each}
				</optgroup>
			{/each}
		</select>
		{#if !assets.length}
			<p class="image-hint" id={`${prefix}-field-${field.name}-hint`}>Upload an image in the Images tab to select it here, or enter an image URL above.</p>
		{/if}
	{/if}
{/each}

<style>
	label { display: block; font-size: 11px; font-weight: 600; color: var(--ui-text, #5c7050); margin: 15px 0 7px; }
	label small { font-weight: 400; color: var(--ui-muted, #7c8772); margin-left: 5px; }
	input, textarea, select { width: 100%; border: 1px solid var(--ui-border, #d7dfcd); background: white; border-radius: 5px; padding: 10px 11px; font: inherit; font-size: 12px; color: var(--ui-text, #34492c); }
	textarea { resize: vertical; line-height: 1.7; min-height: 85px; }
	.image-hint { font-size: 11px; color: var(--ui-muted, #7c8772); line-height: 1.7; }
	input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 2px; }
</style>
