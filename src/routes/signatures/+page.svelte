<script lang="ts">
	import { afterNavigate, beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import WorkspaceNavigation from '#lib/WorkspaceNavigation.svelte';
	import SignatureEditor from '#lib/SignatureEditor.svelte';
	import { version as appVersion } from '../../../package.json';
	import { jsonRequest, requestJson } from '#lib/api-client.js';
	import { useToasts } from '#lib/toast-context.js';
	import type { SignatureDetail } from '#lib/signatures.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const toasts = useToasts();
	let sidebarOpen = $state(false);
	let name = $state('');
	let creating = $state(false);
	let signingOut = $state(false);
	let editorDirty = $state(false);
	let leaving = false;
	const dirty = $derived(editorDirty || Boolean(name.trim()));

	beforeNavigate((navigation) => {
		if (dirty && !leaving && !window.confirm('You have unsaved signature changes. Leave and discard them?')) navigation.cancel();
	});
	afterNavigate(() => { sidebarOpen = false; name = ''; editorDirty = false; });

	function beforeUnload(event: BeforeUnloadEvent) {
		if (dirty) { event.preventDefault(); event.returnValue = ''; }
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;
		creating = true;
		try {
			const result = await requestJson<{ signature: SignatureDetail }>('/api/signatures', jsonRequest('POST', { name }));
			name = '';
			await goto(`/signatures?signature=${result.signature.id}`, { invalidateAll: true });
			toasts.success('Signature created. Upload an HTML variation to get started.');
		} catch (cause) { toasts.error(cause instanceof Error ? cause.message : 'The signature could not be created.'); }
		finally { creating = false; }
	}

	async function logout() {
		if (signingOut) return;
		if (dirty && !window.confirm('Sign out and discard unsaved signature changes?')) return;
		signingOut = true;
		try {
			await requestJson('/api/auth/sign-out', jsonRequest('POST', {}));
			leaving = true;
			await goto('/login', { invalidateAll: true });
		} catch (cause) { toasts.error(cause instanceof Error ? cause.message : 'Sign-out failed.'); }
		finally { signingOut = false; }
	}
</script>

<svelte:head><title>Email signatures — {data.settings.applicationName}</title></svelte:head>
<svelte:window onbeforeunload={beforeUnload} />

<div class="app">
	<WorkspaceNavigation bind:open={sidebarOpen} applicationName={data.settings.applicationName} projects={data.projects} signatures={data.signatures} selectedSignatureId={data.selected?.id} user={data.user} isAdmin={data.isAdmin} {signingOut} onSignOut={logout} />
	<main class="workspace">
		<header class="project-header">
			<div class="workspace-location">
				<button class="menu-toggle" aria-label="Open navigation menu" aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onclick={() => sidebarOpen = !sidebarOpen}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span>Menu</span>
				</button>
				<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li aria-current="page"><span class="crumb-name" title={data.selected?.name}>{data.selected?.name ?? 'Signatures'}</span></li></ol></nav>
			</div>
		</header>
		{#if data.creating}
			<form class="inline-form panel" onsubmit={create}>
				<label for="signature-name">Signature name</label>
				<input id="signature-name" bind:value={name} maxlength="160" required disabled={creating} />
				<button class="primary" disabled={creating || !name.trim()}>{creating ? 'Creating...' : 'Create signature'}</button>
				<a class="secondary" href="/signatures">Cancel</a>
			</form>
		{:else if data.selected}
			{#key data.selected.id}
				<SignatureEditor initial={data.selected} canDelete={data.isAdmin} onDirtyChange={(value) => editorDirty = value} onSaved={invalidateAll} onDeleted={async () => { editorDirty = false; await goto('/signatures', { invalidateAll: true }); }} />
			{/key}
		{:else}
			<section class="panel empty-state">
				<h2>A signature for every contact.</h2>
				<p>Upload separate HTML variations, then manage the contacts shared by all variations in that signature. Preview and download a personalized HTML signature for each contact.</p>
				<a class="primary" href="/signatures?new=1">+ New signature</a>
				{#if data.signatures.length}<ul>{#each data.signatures as signature (signature.id)}<li><a href={`/signatures?signature=${signature.id}`}>{signature.name}</a></li>{/each}</ul>{/if}
			</section>
		{/if}
		<footer>Team Switch © 2026 · v{appVersion}</footer>
	</main>
</div>

<style>
	.empty-state li { margin: 12px 0; font-size: 13px; }
	.empty-state li a { color: var(--ui-primary, #304d36); }
</style>
