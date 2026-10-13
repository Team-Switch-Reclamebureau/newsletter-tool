<script lang="ts">
	import SettingsLayout from '#lib/SettingsLayout.svelte';
	import PasswordForm from '#lib/PasswordForm.svelte';
	import SettingsTabs from '#lib/SettingsTabs.svelte';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { jsonRequest, requestJson } from '#lib/api-client.js';
	import { useToasts } from '#lib/toast-context.js';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const toasts = useToasts();
	let name = $state(untrack(() => data.name));
	let email = $state(untrack(() => data.email));
	let currentPassword = $state('');
	let savingName = $state(false);
	let changingEmail = $state(false);
	let pendingEmail = $state('');
	let activeTab = $state(untrack(() => data.verificationError || data.emailChanged ? 'email' : 'profile'));
	const tabs = [
		{ id: 'profile', label: 'Your name' },
		{ id: 'email', label: 'Email address' },
		{ id: 'password', label: 'Password' }
	];

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		savingName = true;
		try {
			await requestJson('/api/account/profile', jsonRequest('PATCH', { name }));
			await invalidateAll();
			name = data.name;
			toasts.success('Your name has been saved.');
		} catch (cause) {
			toasts.error(cause instanceof Error ? cause.message : 'Your name could not be saved. Please try again.');
		} finally { savingName = false; }
	}

	async function changeEmail(event: SubmitEvent) {
		event.preventDefault();
		changingEmail = true;
		try {
			await requestJson('/api/account/profile', jsonRequest('POST', { email, currentPassword }));
			pendingEmail = email.toLowerCase();
			currentPassword = '';
			toasts.success('Verification email sent. Check your new inbox and spam folder.');
		} catch (cause) {
			toasts.error(cause instanceof Error ? cause.message : 'Your email change could not be requested. Please try again.');
		} finally { changingEmail = false; }
	}
</script>

<SettingsLayout title="User settings" applicationName={data.settings.applicationName} description="Manage your name, email address, and password.">
	{#if data.verificationError}<p class="error" role="alert">{data.verificationError}</p>
	{:else if data.emailChanged}<p role="status">Email address verified. Your sign-in address is now {data.email}.</p>{/if}
	<SettingsTabs {tabs} bind:active={activeTab} label="User settings" />
	<div class="settings-panel" id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile" tabindex="0" hidden={activeTab !== 'profile'}>
		<h2 id="profile-heading">Your name</h2>
		<form onsubmit={saveName}>
			<fieldset disabled={savingName}>
				<label for="profile-name">Name</label>
				<input id="profile-name" autocomplete="name" bind:value={name} maxlength="80" required />
				<button disabled={!name.trim() || name.trim() === data.name}>{savingName ? 'Saving...' : 'Save name'}</button>
			</fieldset>
		</form>
	</div>
	<div class="settings-panel" id="settings-panel-email" role="tabpanel" aria-labelledby="settings-tab-email" tabindex="0" hidden={activeTab !== 'email'}>
		<h2 id="email-heading">Email address</h2>
		<p>Current sign-in address: {data.email}</p>
		<p>Confirm your current password, then verify your new address using the emailed link. Your current address stays active until verification.</p>
		<form onsubmit={changeEmail}>
			<fieldset disabled={changingEmail}>
				<label for="profile-email">New email address</label>
				<input id="profile-email" type="email" autocomplete="email" bind:value={email} maxlength="254" required />
				<label for="email-current-password">Current password</label>
				<input id="email-current-password" type="password" autocomplete="current-password" bind:value={currentPassword} maxlength="128" required />
				<button disabled={email.toLowerCase() === data.email.toLowerCase()}>{changingEmail ? 'Sending...' : 'Send verification email'}</button>
			</fieldset>
		</form>
		{#if pendingEmail}<p role="status">A verification link was sent to {pendingEmail}. It expires in one hour.</p>{/if}
	</div>
	<div class="settings-panel" id="settings-panel-password" role="tabpanel" aria-labelledby="settings-tab-password" tabindex="0" hidden={activeTab !== 'password'}>
		<h2 id="password-heading">Change password</h2>
		<PasswordForm mode="change" />
	</div>
</SettingsLayout>

<style>
	h2 { font-size: 16px; margin-top: 0; }
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	label { display: block; font-size: 12px; font-weight: 600; margin: 20px 0 8px; }
	input { width: 100%; padding: 12px; border: 1px solid var(--ui-border, #cfdac3); border-radius: 5px; font: inherit; box-sizing: border-box; }
	p { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #7b8970); overflow-wrap: anywhere; }
	button { margin-top: 24px; width: 100%; background: var(--ui-primary, #304d36); color: var(--ui-on-primary, white); border: 0; border-radius: 5px; padding: 13px; cursor: pointer; font: inherit; font-size: 12px; }
	button:disabled { opacity: .6; cursor: not-allowed; }
	input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #718f53); outline-offset: 3px; }
	.error { color: #9b4335; }
</style>
