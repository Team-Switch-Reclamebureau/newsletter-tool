<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import AccountPanel from '#lib/AccountPanel.svelte';
	import PasswordForm from '#lib/PasswordForm.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	onMount(() => { void tick().then(() => replaceState('/reset-password', page.state)); });
</script>

<svelte:head><meta name="referrer" content="no-referrer" /></svelte:head>
<AccountPanel title={data.invitation ? 'Accept your invitation' : 'Reset your password'} applicationName={data.settings.applicationName}>
	{#if data.token}
		<PasswordForm mode="reset" token={data.token} />
	{:else}
		<p role="alert">This password link is invalid. <a href="/forgot-password">Request a new link</a>.</p>
	{/if}
</AccountPanel>
