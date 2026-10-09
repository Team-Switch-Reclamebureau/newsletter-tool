<script lang="ts">
	let { name, email, isAdmin = false, signingOut = false, onSignOut }: {
		name: string;
		email: string;
		isAdmin?: boolean;
		signingOut?: boolean;
		onSignOut: () => void;
	} = $props();
	const initials = $derived(name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || email[0].toUpperCase());
</script>

<section class="account-menu" aria-label="Your account">
	<div class="profile">
		<span class="avatar" aria-hidden="true">{initials}</span>
		<div class="identity"><strong title={name}>{name}</strong><span title={email}>{email}</span></div>
	</div>
	<div class="account-actions">
		{#if isAdmin}
			<a href="/admin">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
				<span>Admin settings</span><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
			</a>
		{/if}
		<a href="/account">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>
			<span>Change password</span><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
		</a>
		<button class="sign-out" disabled={signingOut} onclick={onSignOut}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M9 12h12m-4-4 4 4-4 4" /></svg>
			<span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
		</button>
	</div>
</section>

<style>
	.account-menu { border: 1px solid var(--ui-border, #dce2d4); border-radius: 12px; background: var(--ui-surface, #fcfdfb); box-shadow: 0 3px 12px rgb(25 45 30 / 4%); overflow: hidden; }
	.profile { display: flex; align-items: center; gap: 10px; padding: 15px 13px; border-bottom: 1px solid var(--ui-border, #dce2d4); }
	.avatar { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px; background: var(--ui-active, #e3ecd6); color: var(--ui-text, #3f5734); font-size: 12px; font-weight: 700; letter-spacing: .5px; }
	.identity { min-width: 0; }
	.identity strong, .identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.identity strong { color: var(--ui-text, #3f5734); font-size: 12px; font-weight: 650; }
	.identity span { margin-top: 4px; color: var(--ui-muted, #718161); font-size: 10px; }
	.account-actions { display: grid; gap: 2px; padding: 6px; }
	a, button { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; border-radius: 7px; padding: 10px 8px; color: var(--ui-text, #536a45); background: transparent; text-decoration: none; text-align: left; font: inherit; font-size: 11px; transition: background .15s, color .15s; }
	a:hover, button:hover:not(:disabled) { background: var(--ui-soft, #eef0e9); }
	svg { flex-shrink: 0; width: 16px; height: 16px; color: var(--ui-muted, #718161); }
	.chevron { margin-left: auto; width: 14px; height: 14px; }
	.sign-out { color: #a45443; }
	.sign-out svg { color: inherit; }
	.sign-out:hover:not(:disabled) { background: #fff2ec; }
</style>
