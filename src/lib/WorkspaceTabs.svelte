<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="view-tabs" aria-label={label}>
	{@render children()}
</div>

<style>
	.view-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
	.view-tabs :global(button) { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 7px; color: var(--ui-muted, #7b8a6e); background: transparent; padding: 10px 13px; font-size: 12px; white-space: nowrap; }
	.view-tabs :global(button:hover) { color: var(--ui-text); background: var(--ui-soft); }
	.view-tabs :global(button.active) { color: var(--ui-base-ink, #3f5f2e); background: var(--ui-active, #e3ecd6); font-weight: 600; }
</style>
