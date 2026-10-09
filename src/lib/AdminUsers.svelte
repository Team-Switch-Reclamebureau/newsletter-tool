<script lang="ts">
	import { untrack } from 'svelte';
	import { jsonRequest, requestJson } from './api-client';
	import type { AdminUser } from './admin-users';
	import { useToasts } from './toast-context';

	let { initial, currentUserId }: { initial: AdminUser[]; currentUserId: string } = $props();
	const toasts = useToasts();
	let users = $state(untrack(() => initial));
	let name = $state('');
	let email = $state('');
	let busy = $state(false);

	async function refresh() {
		busy = true;
		try { users = (await requestJson<{ users: AdminUser[] }>('/api/admin/users')).users; }
		catch (cause) { toasts.error(cause instanceof Error ? cause.message : 'Users could not be loaded.'); }
		finally { busy = false; }
	}

	async function action(path: string, method: string, body: unknown, success: string) {
		busy = true;
		try {
			users = (await requestJson<{ users: AdminUser[] }>(path, jsonRequest(method, body))).users;
			toasts.success(success);
			if (path === '/api/admin/users') { name = ''; email = ''; }
		} catch (cause) {
			toasts.error(cause instanceof Error ? cause.message : 'The operation failed. Please try again.');
		} finally { busy = false; }
	}

	function invite(event: SubmitEvent) {
		event.preventDefault();
		void action('/api/admin/users', 'POST', { name, email }, 'Invitation sent. The link expires in one hour.');
	}

	function role(user: AdminUser) {
		if (!window.confirm(`${user.isAdmin ? 'Revoke' : 'Grant'} administrator access for ${user.email}? Administrators can manage users, roles, and SMTP credentials.`)) return;
		void action(`/api/admin/users/${encodeURIComponent(user.id)}`, 'PATCH', { isAdmin: !user.isAdmin }, 'Administrator access updated.');
	}
</script>

<p>Invite users to choose their own password. Project access is granted separately from each project's Sharing tab.</p>
<form onsubmit={invite}>
	<fieldset disabled={busy}>
		<label for="invite-name">Name</label><input id="invite-name" bind:value={name} maxlength="80" required />
		<label for="invite-email">Email address</label><input id="invite-email" type="email" bind:value={email} maxlength="254" required />
		<button type="submit">Invite user</button>
	</fieldset>
</form>
<p>After a delivery failure, refresh the list and resend the pending invitation once SMTP is fixed.</p>
<button type="button" class="secondary" disabled={busy} onclick={refresh}>Refresh users</button>
<ul>
	{#each users as user (user.id)}
		<li>
			<strong>{user.name}</strong><span>{user.email}</span>
			<span>{user.isAdmin ? 'Administrator' : 'User'} · {user.invitedAt ? (user.sentAt ? 'Invitation pending' : 'Invitation not sent') : 'Active'}</span>
			<div class="actions">
				{#if user.invitedAt}<button class="secondary" disabled={busy} onclick={() => action(`/api/admin/users/${encodeURIComponent(user.id)}`, 'POST', {}, 'Invitation resent. The link expires in one hour.')}>Resend invitation</button>{/if}
				{#if user.id !== currentUserId}<button class="secondary" disabled={busy} onclick={() => role(user)}>{user.isAdmin ? 'Revoke admin access' : 'Make administrator'}</button>{/if}
			</div>
		</li>
	{/each}
</ul>

<style>
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	label { display: block; font-size: 12px; font-weight: 600; margin: 18px 0 8px; }
	input { box-sizing: border-box; width: 100%; font: inherit; border: 1px solid var(--ui-border, #d4dec8); border-radius: 5px; padding: 10px; }
	p, span { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #78886b); }
	button { font: inherit; font-size: 12px; border: 0; padding: 11px 16px; border-radius: 5px; cursor: pointer; background: var(--ui-primary, #425f30); color: var(--ui-on-primary, white); margin-top: 12px; }
	.secondary { background: var(--ui-surface, #fcfdfb); color: var(--ui-text, #536a45); border: 1px solid var(--ui-border, #d3ddc8); }
	button:disabled { opacity: .55; cursor: default; }
	ul { list-style: none; margin: 20px 0 0; padding: 0; }
	li { border-top: 1px solid var(--ui-border, #d3ddc8); padding: 16px 0; overflow-wrap: anywhere; }
	strong, span { display: block; }
	.actions { display: flex; gap: 8px; flex-wrap: wrap; }
	input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
</style>
