<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	let { open = $bindable(false), children }: { open?: boolean; children: Snippet } = $props();
	const compact = new MediaQuery('(max-width: 1100px)', false);
	let drawer = $state<HTMLDialogElement>();

	$effect(() => {
		if (!compact.current) { open = false; return; }
		if (!drawer) return;
		if (open && !drawer.open) drawer.showModal();
		else if (!open && drawer.open) drawer.close();
	});

	$effect(() => {
		if (!compact.current || !open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	function backdropClick(event: MouseEvent) {
		if (!drawer || event.target !== drawer) return;
		const bounds = drawer.getBoundingClientRect();
		if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) open = false;
	}
</script>

{#if compact.current}
	<dialog id="workspace-sidebar" bind:this={drawer} aria-label="Workspace navigation" aria-modal="true" onclose={() => open = false} onclick={backdropClick} onkeydown={(event) => { if (event.key === 'Escape') open = false; }}>
		<div class="drawer-heading">
			<span>Navigation</span>
			<button aria-label="Close navigation menu" onclick={() => open = false}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
			</button>
		</div>
		{@render children()}
	</dialog>
{:else}
	<aside id="workspace-sidebar" aria-label="Workspace navigation">
		{@render children()}
	</aside>
{/if}

<style>
	aside, dialog { flex-direction: column; width: 250px; height: 100dvh; flex-shrink: 0; background: var(--ui-soft, #eef0e9); color: var(--ui-text, #25382d); border: 0; border-right: 1px solid var(--ui-border, #dce1d6); padding: 32px 20px 22px; }
	aside { position: sticky; top: 0; align-self: flex-start; display: flex; }
	aside > :global(*), dialog > :global(*) { flex-shrink: 0; }
	aside > :global(nav), dialog > :global(nav) { flex-shrink: 1; }
	dialog { position: fixed; inset: 0 auto 0 0; margin: 0; width: min(290px, calc(100vw - 44px)); max-width: none; max-height: none; padding: 18px 20px 22px; overflow-y: auto; box-shadow: 8px 0 40px rgb(15 30 20 / 15%); }
	dialog[open] { display: flex; }
	dialog::backdrop { background: rgb(15 25 20 / 40%); }
	.drawer-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px; }
	.drawer-heading span { color: var(--ui-muted, #718161); font-size: 11px; font-weight: 600; }
	button { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--ui-border, #dce1d6); border-radius: 7px; background: var(--ui-surface, #fcfdfb); color: var(--ui-text, #536a45); }
	svg { width: 18px; height: 18px; }
	@media (max-width: 1100px) { aside { display: none; } }
</style>
