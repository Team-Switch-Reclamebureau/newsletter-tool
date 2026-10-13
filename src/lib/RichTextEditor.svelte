<script lang="ts">
	import { onMount } from 'svelte';
	import { createRichTextEditor } from './rich-text-editor';

	let { id, label, value, onUpdate }: {
		id: string;
		label: string;
		value: string;
		onUpdate: (value: string) => void;
	} = $props();
	let element: HTMLDivElement;
	let editor = $state<ReturnType<typeof createRichTextEditor>>();

	onMount(() => {
		editor = createRichTextEditor(element, value, { id, label, onUpdate: (next) => onUpdate(next) });
		return () => editor?.destroy();
	});
	$effect(() => { editor?.setValue(value); });
</script>

<div bind:this={element}></div>
