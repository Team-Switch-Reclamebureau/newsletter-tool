<script lang="ts">
	import { jsonRequest, requestJson } from './api-client';
	import { useToasts } from './toast-context';

	let { mode, token = '' }: { mode: 'recovery' | 'reset' | 'change'; token?: string } = $props();
	const toasts = useToasts();
	let email = $state('');
	let currentPassword = $state('');
	let password = $state('');
	let confirmation = $state('');
	let message = $state('');
	let busy = $state(false);
	let complete = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (mode !== 'recovery' && password !== confirmation) { message = 'The new passwords do not match.'; return; }
		busy = true;
		try {
			if (mode === 'recovery') {
				await requestJson('/api/auth/request-password-reset', jsonRequest('POST', { email }));
				toasts.success('If this address has an account, an email with a one-hour password link has been sent. Check your inbox and spam folder.');
			} else if (mode === 'reset') {
				await requestJson('/api/auth/reset-password', jsonRequest('POST', { token, newPassword: password }));
				toasts.success('Your password has been saved. Sign in with your new password.');
				complete = true;
			} else {
				await requestJson('/api/auth/change-password', jsonRequest('POST', { currentPassword, newPassword: password, revokeOtherSessions: true }));
				toasts.success('Password changed. Other sessions have been signed out.');
			}
			currentPassword = '';
			password = '';
			confirmation = '';
		} catch (cause) {
			toasts.error(cause instanceof Error ? cause.message : 'The password operation failed. Please try again.');
		} finally { busy = false; }
	}
</script>

{#if !complete}
	<form onsubmit={submit}>
		<fieldset disabled={busy}>
			{#if mode === 'recovery'}
				<label for="recovery-email">Email address</label><input id="recovery-email" type="email" autocomplete="email" bind:value={email} maxlength="254" required />
			{:else}
				{#if mode === 'change'}<label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" bind:value={currentPassword} required maxlength="128" />{/if}
				<label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" bind:value={password} minlength="12" maxlength="128" required />
				<label for="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autocomplete="new-password" bind:value={confirmation} minlength="12" maxlength="128" required />
				<p>Use between 12 and 128 characters.</p>
			{/if}
			<button type="submit">{busy ? 'Working…' : mode === 'recovery' ? 'Send password reset email' : mode === 'change' ? 'Change password' : 'Save password'}</button>
		</fieldset>
	</form>
{:else}
	<p>Your password has been saved. Sign in with your new password.</p>
{/if}
{#if message}<p class="error" role="alert">{message}</p>{/if}
{#if mode === 'reset'}<p><a href="/forgot-password">Request a new link</a> if this link has expired or already been used.</p>{/if}
{#if mode !== 'change'}<p><a href="/login">Back to sign in</a></p>{/if}

<style>
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	label { display: block; font-size: 12px; font-weight: 600; margin: 20px 0 8px; }
	input { width: 100%; padding: 12px; border: 1px solid var(--ui-border, #cfdac3); border-radius: 5px; font: inherit; box-sizing: border-box; }
	p, a { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #7b8970); }
	button { margin-top: 24px; width: 100%; background: var(--ui-primary, #304d36); color: var(--ui-on-primary, white); border: 0; border-radius: 5px; padding: 13px; cursor: pointer; font: inherit; font-size: 12px; }
	button:disabled { opacity: .6; cursor: wait; }
	input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--ui-accent, #718f53); outline-offset: 3px; }
	.error { color: #9b4335; }
</style>
