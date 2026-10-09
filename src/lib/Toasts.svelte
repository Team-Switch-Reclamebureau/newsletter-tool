<script lang="ts">
	import type { Toast, ToastManager } from './toasts';

	let { toasts }: { toasts: ToastManager } = $props();
</script>

{#snippet notification(toast: Toast)}
	<div class="toast" class:error={toast.kind === 'error'} role="group" aria-label={toast.kind === 'error' ? 'Error notification' : 'Success notification'}
		onmouseenter={() => toasts.pause(toast.id, 'hover')}
		onmouseleave={() => toasts.resume(toast.id, 'hover')}
		onfocusin={() => toasts.pause(toast.id, 'focus')}
		onfocusout={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) toasts.resume(toast.id, 'focus'); }}>
		<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
			{#if toast.kind === 'error'}<circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3v1" />{:else}<path d="m5 12 4 4L19 6" />{/if}
		</svg>
		<p>{toast.message}</p>
		<button type="button" aria-label="Dismiss notification" onclick={() => toasts.dismiss(toast.id)}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
		</button>
	</div>
{/snippet}

<section class="toaster" aria-label="Notifications">
	<div class="stack" role="status" aria-live="polite" aria-relevant="additions">
		{#each $toasts.filter((toast) => toast.kind === 'success') as toast (toast.id)}{@render notification(toast)}{/each}
	</div>
	<div class="stack" role="alert" aria-live="assertive" aria-relevant="additions">
		{#each $toasts.filter((toast) => toast.kind === 'error') as toast (toast.id)}{@render notification(toast)}{/each}
	</div>
</section>

<style>
	.toaster { position: fixed; z-index: 1000; right: max(20px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); width: min(420px, calc(100vw - 40px)); max-height: calc(100dvh - 40px); overflow-y: auto; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	.stack { display: grid; gap: 10px; }
	.stack + .stack:not(:empty) { margin-top: 10px; }
	.toast { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--ui-border, #dce2d4); border-radius: 12px; background: var(--ui-surface, #fcfdfb); color: var(--ui-text, #526348); box-shadow: 0 8px 32px #25382d24; pointer-events: auto; }
	.status-icon { flex-shrink: 0; width: 20px; height: 20px; color: var(--ui-accent, #425f30); }
	p { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
	button { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 28px; height: 28px; margin: -4px -4px 0 0; padding: 4px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
	button svg { width: 18px; height: 18px; }
	button:hover { background: var(--ui-soft, #eef3e6); }
	button:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 2px; }
	.error { border-color: #d7aaa0; }
	.error .status-icon { color: #9b4335; }
	@media (max-width: 640px) { .toaster { right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); width: calc(100vw - 24px); } }
</style>
