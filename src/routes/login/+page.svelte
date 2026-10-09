<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { jsonRequest, requestJson } from '#lib/api-client.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let email = $state('');
	let password = $state('');
	let message = $state('');
	let loading = $state(false);

	async function login(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		loading = true;
		try {
			await requestJson('/api/auth/sign-in/email', jsonRequest('POST', { email, password }));
			password = '';
			await invalidateAll();
			await goto('/');
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.';
		} finally { loading = false; }
	}
</script>

<svelte:head><title>Sign in — {data.settings.applicationName}</title></svelte:head>

<main>
	<div class="brand">{data.settings.applicationName}<span>.</span></div>
	<section>
		<div class="eyebrow">YOUR NEWSLETTER WORKSPACE</div>
		<h1>Welcome back.</h1>
		<p>Sign in to your projects, stories, and image library.</p>
		<form onsubmit={login}>
			<label for="email">Email address</label><input id="email" type="email" autocomplete="username" bind:value={email} required />
			<label for="password">Password</label><input id="password" type="password" autocomplete="current-password" bind:value={password} required />
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<button disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
		</form>
		<p><a href="/forgot-password">Forgot your password?</a></p>
		<small>Invite-only workspace. Contact your administrator for an account.</small>
	</section>
</main>

<style>
	:global(body) { margin: 0; background: #f3f5ef; color: #2d4331; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 25px; box-sizing: border-box; }
	.brand { font-size: 32px; font-weight: 750; letter-spacing: -1.5px; margin-bottom: 35px; }
	.brand { overflow-wrap: anywhere; max-width: 100%; color: var(--ui-base-ink, #425f30); }
	.brand span { color: var(--ui-accent, #88a65d); }
	section { max-width: 420px; width: 100%; padding: 36px; background: var(--ui-surface, #fbfcf9); border: 1px solid var(--ui-border, #dce3d2); border-radius: 16px; box-shadow: var(--ui-shadow); box-sizing: border-box; }
	.eyebrow { font-size: 9px; letter-spacing: 1.5px; color: var(--ui-muted, #839273); }
	h1 { font-size: 30px; font-weight: 650; letter-spacing: -1px; margin: 15px 0; }
	p { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #7b8970); }
	label { display: block; font-size: 12px; margin: 20px 0 8px; }
	input { width: 100%; padding: 12px; border: 1px solid var(--ui-border, #cfdac3); border-radius: 5px; font: inherit; box-sizing: border-box; }
	input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent, #718f53); outline-offset: 3px; }
	button { margin-top: 24px; width: 100%; background: var(--ui-primary, #304d36); color: var(--ui-on-primary, white); border: 0; border-radius: 7px; padding: 13px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; }
	button:disabled { opacity: .6; cursor: wait; }
	small { display: block; font-size: 10px; color: var(--ui-muted, #849276); line-height: 1.8; margin-top: 24px; }
	.error { color: #9b4335; }
	a { color: var(--ui-text, #526348); }
</style>
