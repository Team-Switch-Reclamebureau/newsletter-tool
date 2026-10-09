<script lang="ts">
	import { untrack } from 'svelte';
	import { jsonRequest, requestJson } from './api-client';
	import { emailSettingsError, type EmailSettings } from './email-settings';

	let { initial, dirty = $bindable(false) }: { initial: EmailSettings; dirty?: boolean } = $props();
	let saved = $state(untrack(() => ({ ...initial })));
	let settings = $state(untrack(() => ({ ...initial })));
	let password = $state('');
	let clearPassword = $state(false);
	let busy = $state(false);
	let message = $state('');
	let failed = $state(false);
	$effect(() => { dirty = JSON.stringify(settings) !== JSON.stringify(saved) || Boolean(password) || clearPassword; });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		const body = { ...settings, password, clearPassword };
		const invalid = emailSettingsError(body);
		if (invalid) { failed = true; message = invalid; return; }
		busy = true;
		try {
			const result = await requestJson<{ settings: EmailSettings }>('/api/admin/email', jsonRequest('PATCH', body));
			saved = result.settings;
			settings = { ...saved };
			password = '';
			clearPassword = false;
			failed = false;
			message = 'Email settings saved.';
		} catch (cause) {
			failed = true;
			message = cause instanceof Error ? cause.message : 'Email settings could not be saved.';
		} finally { busy = false; }
	}

	async function testEmail() {
		busy = true;
		message = '';
		try {
			const result = await requestJson<{ message: string }>('/api/admin/email', jsonRequest('POST', {}));
			failed = false;
			message = result.message;
		} catch (cause) {
			failed = true;
			message = cause instanceof Error ? cause.message : 'The test email could not be sent.';
		} finally { busy = false; }
	}
</script>

<form onsubmit={save}>
	<fieldset disabled={busy}>
		<p>Used for account invitations and password recovery, not newsletter delivery.</p>
		<label for="smtp-host">SMTP hostname</label><input id="smtp-host" bind:value={settings.host} required maxlength="253" />
		<label for="smtp-port">Port</label><input id="smtp-port" type="number" min="1" max="65535" bind:value={settings.port} required />
		<label for="smtp-security">Connection security</label>
		<select id="smtp-security" bind:value={settings.security}><option value="starttls">STARTTLS (usually port 587)</option><option value="tls">TLS (usually port 465)</option><option value="none">Unencrypted internal relay only</option></select>
		{#if settings.security === 'none'}<p class="warning">No encryption: use only with a trusted internal relay. Credentials and account links travel in plaintext.</p>{/if}
		<label for="smtp-username">Username (leave blank for an unauthenticated relay)</label><input id="smtp-username" bind:value={settings.username} maxlength="254" autocomplete="off" />
		<label for="smtp-password">SMTP password</label><input id="smtp-password" type="password" bind:value={password} disabled={clearPassword} maxlength="4096" autocomplete="new-password" placeholder={saved.passwordConfigured ? 'Saved password; leave blank to keep it' : 'No password saved'} />
		<label class="checkbox"><input type="checkbox" bind:checked={clearPassword} /> Clear saved SMTP password</label>
		<label for="smtp-from">Sender email address</label><input id="smtp-from" type="email" bind:value={settings.fromEmail} maxlength="254" required />
		<label for="smtp-name">Sender name</label><input id="smtp-name" bind:value={settings.fromName} maxlength="254" />
		<div class="actions"><button disabled={!dirty} type="submit">{busy ? 'Working…' : 'Save email settings'}</button><button type="button" class="secondary" disabled={dirty || !saved.host} onclick={testEmail}>Send test email to me</button></div>
		<p>Save first, then test. SMTP acceptance does not guarantee inbox delivery.</p>
	</fieldset>
</form>
{#if message}<p class:error={failed} role={failed ? 'alert' : 'status'}>{message}</p>{/if}

<style>
	fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
	label { display: block; font-size: 12px; font-weight: 600; margin: 18px 0 8px; }
	input, select { box-sizing: border-box; width: 100%; font: inherit; color: var(--ui-text, #34492c); background: white; border: 1px solid var(--ui-border, #d4dec8); border-radius: 5px; padding: 10px; }
	.checkbox { display: flex; align-items: center; gap: 8px; }
	input[type="checkbox"] { width: auto; }
	p { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #78886b); }
	.actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
	button { font: inherit; font-size: 12px; border: 0; padding: 11px 16px; border-radius: 5px; cursor: pointer; background: var(--ui-primary, #425f30); color: var(--ui-on-primary, white); }
	.secondary { background: var(--ui-surface, #fcfdfb); color: var(--ui-text, #536a45); border: 1px solid var(--ui-border, #d3ddc8); }
	button:disabled { opacity: .55; cursor: default; }
	input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
	.error, .warning { color: #9b4335; }
</style>
