<script lang="ts">
	import { beforeNavigate, invalidateAll } from '$app/navigation';
	import { jsonRequest, requestJson } from '#lib/api-client.js';
	import { brandingError, DEFAULT_APPLICATION_SETTINGS, interfaceTheme, type ApplicationSettings } from '#lib/application-settings.js';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import AdminEmailSettings from '#lib/AdminEmailSettings.svelte';
	import AdminUsers from '#lib/AdminUsers.svelte';
	import { useToasts } from '#lib/toast-context.js';

	let { data }: { data: PageData } = $props();
	const toasts = useToasts();
	const initial = untrack(() => data.settings);
	let applicationName = $state(initial.applicationName);
	let baseColor = $state(initial.baseColor);
	let accentColor = $state(initial.accentColor);
	let saved = $state<ApplicationSettings>({ ...initial });
	let saving = $state(false);
	let emailDirty = $state(false);
	const brandingDirty = $derived(applicationName !== saved.applicationName || baseColor !== saved.baseColor || accentColor !== saved.accentColor);
	const dirty = $derived(brandingDirty || emailDirty);

	beforeNavigate((navigation) => {
		if (dirty && !window.confirm('Discard unsaved administrator settings?')) navigation.cancel();
	});

	function beforeUnload(event: BeforeUnloadEvent) {
		if (dirty) { event.preventDefault(); event.returnValue = ''; }
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const invalid = brandingError(applicationName, baseColor, accentColor);
		if (invalid) { toasts.error(invalid); return; }
		saving = true;
		try {
			const result = await requestJson<{ settings: ApplicationSettings }>('/api/admin/settings', jsonRequest('PATCH', {
				applicationName, baseColor, accentColor, revision: saved.revision
			}));
			saved = result.settings;
			applicationName = saved.applicationName;
			baseColor = saved.baseColor;
			accentColor = saved.accentColor;
			await invalidateAll();
			toasts.success('Settings saved. Branding applies to the workspace and sign-in screen for all users.');
		} catch (cause) {
			toasts.error(cause instanceof Error ? cause.message : 'Settings could not be saved. Please try again.');
		} finally { saving = false; }
	}

	function reset() {
		applicationName = DEFAULT_APPLICATION_SETTINGS.applicationName;
		baseColor = DEFAULT_APPLICATION_SETTINGS.baseColor;
		accentColor = DEFAULT_APPLICATION_SETTINGS.accentColor;
	}
</script>

<svelte:window onbeforeunload={beforeUnload} />
<svelte:head><title>Admin settings — {data.settings.applicationName}</title></svelte:head>

<main>
	<header><a class="brand" href="/">{data.settings.applicationName}<span>.</span></a><a href="/">Back to workspace</a></header>
	<h1>Admin settings</h1>
	<p>Application-wide settings. Only administrators can change them.</p>
	<section aria-labelledby="branding-heading">
		<h2 id="branding-heading">Branding</h2>
		<form onsubmit={save}>
			<fieldset disabled={saving}>
				<label for="application-name">Application name</label>
				<input id="application-name" bind:value={applicationName} maxlength="80" required />
				<label for="base-color">Base color</label>
				<div class="color-control"><input id="base-color" type="color" bind:value={baseColor} /><output for="base-color">{baseColor}</output></div>
				<p>Sets the palette for backgrounds, panels, borders, and interface text.</p>
				<label for="accent-color">Accent color</label>
				<div class="color-control"><input id="accent-color" type="color" bind:value={accentColor} /><output for="accent-color">{accentColor}</output></div>
				<p>Used for primary buttons and the application logo. Button text automatically adjusts for contrast.</p>
				<p>Changes affect the interface only, not newsletter templates or exported emails.</p>
				<div class="branding-preview" style={interfaceTheme(baseColor, accentColor)} aria-label="Branding preview">
					<strong>{applicationName || 'Application name'}</strong><button type="button" disabled>Primary button</button>
				</div>
				<div class="actions"><button type="submit" disabled={!brandingDirty}>{saving ? 'Saving…' : 'Save settings'}</button><button class="secondary" type="button" onclick={reset}>Restore defaults</button></div>
			</fieldset>
		</form>
	</section>
	<section aria-labelledby="email-heading"><h2 id="email-heading">Email settings</h2><AdminEmailSettings initial={data.emailSettings} bind:dirty={emailDirty} /></section>
	<section aria-labelledby="users-heading"><h2 id="users-heading">User management</h2><AdminUsers initial={data.users} currentUserId={data.currentUserId} /></section>
</main>

<style>
	:global(body) { margin: 0; background: #f6f7f3; color: #25382d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	main { max-width: 840px; margin: auto; padding: 30px 24px; }
	header { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid var(--ui-border, #dce2d4); margin-bottom: 30px; }
	a { color: var(--ui-text, #526348); font-size: 12px; }
	.brand { font-size: 29px; font-weight: 750; letter-spacing: -1px; text-decoration: none; overflow-wrap: anywhere; color: var(--ui-accent, #425f30); }
	.brand span { color: var(--ui-accent, #839e5d); }
	h1 { font-family: Georgia, serif; font-size: 32px; font-weight: 400; }
	h2 { font-size: 16px; margin-top: 0; }
	p { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #78886b); }
	section { background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #dce2d4); border-radius: 9px; padding: 24px; margin-top: 20px; }
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	label { display: block; font-size: 12px; font-weight: 600; margin: 18px 0 8px; }
	input { box-sizing: border-box; font: inherit; color: var(--ui-text, #34492c); background: white; border: 1px solid var(--ui-border, #d4dec8); border-radius: 5px; padding: 10px; max-width: 100%; }
	input:not([type="color"]) { width: 100%; }
	input[type="color"] { width: 65px; height: 42px; padding: 4px; cursor: pointer; }
	.color-control, .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
	output { font-size: 12px; color: var(--ui-muted, #78886b); }
	.branding-preview { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--ui-soft, #eef3e6); border: 1px solid var(--ui-border, #dce2d4); padding: 18px; border-radius: 6px; margin: 20px 0; overflow-wrap: anywhere; }
	.branding-preview strong { color: var(--ui-accent, #425f30); }
	.branding-preview button { opacity: 1; }
	button { font: inherit; font-size: 12px; border: 0; padding: 11px 16px; border-radius: 5px; cursor: pointer; background: var(--ui-primary, #425f30); color: var(--ui-on-primary, white); }
	button.secondary { background: var(--ui-surface, #fcfdfb); color: var(--ui-text, #536a45); border: 1px solid var(--ui-border, #d3ddc8); }
	button:disabled { opacity: .55; cursor: default; }
	a:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
</style>
