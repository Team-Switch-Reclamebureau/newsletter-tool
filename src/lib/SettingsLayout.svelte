<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, applicationName, description, children }: {
		title: string;
		applicationName: string;
		description: string;
		children: Snippet;
	} = $props();
</script>

<svelte:head><title>{title} — {applicationName}</title></svelte:head>

<main class="settings-layout">
	<header><a class="brand" href="/">{applicationName}<span>.</span></a><a href="/">Back to workspace</a></header>
	<h1>{title}</h1>
	<p>{description}</p>
	{@render children()}
</main>

<style>
	:global(body) { margin: 0; background: #f6f7f3; color: #25382d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	main { max-width: 840px; margin: auto; padding: 30px 24px; }
	header { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid var(--ui-border, #dce2d4); margin-bottom: 30px; }
	a { color: var(--ui-text, #526348); font-size: 12px; }
	.brand { font-size: 29px; font-weight: 750; letter-spacing: -1px; text-decoration: none; overflow-wrap: anywhere; color: var(--ui-base-ink, #425f30); }
	.brand span { color: var(--ui-accent, #839e5d); }
	h1 { font-size: 32px; font-weight: 650; letter-spacing: -1px; }
	p { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #78886b); }
	main :global(.settings-panel) { background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #dce2d4); border-radius: 12px; box-shadow: var(--ui-shadow); padding: 24px; margin-top: 20px; }
	main :global(.settings-panel:focus-visible), a:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
</style>
