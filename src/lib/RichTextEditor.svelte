<script lang="ts">
	import { onMount } from 'svelte';
	import { createRichTextEditor } from './rich-text-editor';

	let { id, label, value, orderedLists = false, disabled = false, onUpdate }: {
		id: string;
		label: string;
		value: string;
		orderedLists?: boolean;
		disabled?: boolean;
		onUpdate: (value: string) => void;
	} = $props();
	let element: HTMLDivElement;
	let editor = $state<ReturnType<typeof createRichTextEditor>>();

	onMount(() => {
		editor = createRichTextEditor(element, value, { id, label, orderedLists, onUpdate: (next) => onUpdate(next) });
		return () => editor?.destroy();
	});
	$effect(() => { editor?.setValue(value); });
	$effect(() => { editor?.setEditable(!disabled); });
</script>

<div bind:this={element}></div>
