<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, applicationName, children }: { title: string; applicationName: string; children: Snippet } = $props();
</script>

<svelte:head><title>{title} — {applicationName}</title></svelte:head>
<main>
	<a class="brand" href="/">{applicationName}<span>.</span></a>
	<section><h1>{title}</h1>{@render children()}</section>
</main>

<style>
	:global(body) { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 25px; box-sizing: border-box; }
	.brand { font-size: 32px; font-weight: 750; letter-spacing: -1.5px; margin-bottom: 35px; overflow-wrap: anywhere; max-width: 100%; color: var(--ui-base-ink, #425f30); text-decoration: none; }
	.brand span { color: var(--ui-accent); }
	section { max-width: 450px; width: 100%; padding: 32px; background: var(--ui-surface, #fbfcf9); border: 1px solid var(--ui-border, #dce3d2); border-radius: 16px; box-shadow: var(--ui-shadow); box-sizing: border-box; }
	h1 { font-size: 30px; font-weight: 650; letter-spacing: -1px; margin: 0 0 15px; }
</style>
