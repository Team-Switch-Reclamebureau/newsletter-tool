<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { DEFAULT_APPLICATION_SETTINGS, interfaceTheme } from '#lib/application-settings.js';
	import { onDestroy } from 'svelte';
	import Toasts from '#lib/Toasts.svelte';
	import { provideToasts } from '#lib/toast-context.js';

	let { children, data }: LayoutProps = $props();
	const toasts = provideToasts();
	onDestroy(toasts.destroy);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if data.settings}<meta name="theme-color" content={data.settings.baseColor} />{/if}
</svelte:head>

<div class="application" style={interfaceTheme(
	data.settings?.baseColor ?? DEFAULT_APPLICATION_SETTINGS.baseColor,
	data.settings?.accentColor ?? DEFAULT_APPLICATION_SETTINGS.accentColor
)}>
	{@render children()}
	<Toasts {toasts} />
</div>

<style>
	:global(body) { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
	:global(button), :global(input), :global(select), :global(textarea) { font-family: inherit; }
	:global(button:focus-visible), :global(a:focus-visible), :global(input:focus-visible), :global(textarea:focus-visible), :global(select:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
	.application { min-height: 100vh; background: var(--ui-bg, transparent); color: var(--ui-text, inherit); }
</style>
