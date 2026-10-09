<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { interfaceTheme } from '#lib/application-settings.js';
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

<div class="application" style={data.settings ? interfaceTheme(data.settings.baseColor, data.settings.accentColor) : ''}>
	{@render children()}
	<Toasts {toasts} />
</div>

<style>
	.application { min-height: 100vh; background: var(--ui-bg, transparent); color: var(--ui-text, inherit); }
</style>
