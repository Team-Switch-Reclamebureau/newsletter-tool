<script lang="ts">
	let { name }: { name: 'editions' | 'templates' | 'image' | 'sharing' | 'content' | 'settings' | 'publish' } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
	{#if name === 'editions'}
		<rect x="5" y="3" width="16" height="16" rx="2" /><path d="M17 21H5a2 2 0 0 1-2-2V7M9 7h8M9 11h8M9 15h4" />
	{:else if name === 'templates'}
		<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" />
	{:else if name === 'image'}
		<rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m21 15-5-5L5 21" />
	{:else if name === 'sharing'}
		<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" />
	{:else if name === 'content'}
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6" />
	{:else if name === 'settings'}
		<path d="M4 7h7M15 7h5M4 17h3M11 17h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
	{:else if name === 'publish'}
		<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />
	{/if}
</svg>

<style>
	svg { width: 16px; height: 16px; flex-shrink: 0; }
</style>
