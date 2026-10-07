<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { interfaceTheme } from '#lib/application-settings.js';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if data.settings}<meta name="theme-color" content={data.settings.baseColor} />{/if}
</svelte:head>

<div class="application" style={data.settings ? interfaceTheme(data.settings.baseColor, data.settings.accentColor) : ''}>
	{@render children()}
</div>

<style>
	.application { min-height: 100vh; background: var(--ui-bg, transparent); color: var(--ui-text, inherit); }
</style>
