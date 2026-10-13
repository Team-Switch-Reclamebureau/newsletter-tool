<script lang="ts">
	let { tabs, active = $bindable(), label }: {
		tabs: readonly { id: string; label: string }[];
		active: string;
		label: string;
	} = $props();

	function navigate(event: KeyboardEvent, index: number) {
		let next: number;
		switch (event.key) {
			case 'ArrowRight': next = (index + 1) % tabs.length; break;
			case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
			case 'Home': next = 0; break;
			case 'End': next = tabs.length - 1; break;
			default: return;
		}
		event.preventDefault();
		active = tabs[next].id;
		const button = event.currentTarget;
		if (button instanceof HTMLButtonElement) {
			button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
		}
	}
</script>

<div class="settings-tabs" role="tablist" aria-label={label}>
	{#each tabs as tab, index (tab.id)}
		<button
			type="button"
			role="tab"
			id={`settings-tab-${tab.id}`}
			aria-controls={`settings-panel-${tab.id}`}
			aria-selected={active === tab.id}
			tabindex={active === tab.id ? 0 : -1}
			onclick={() => active = tab.id}
			onkeydown={(event) => navigate(event, index)}
		>{tab.label}</button>
	{/each}
</div>

<style>
	.settings-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 20px 0; }
	button { font: inherit; font-size: 12px; border: 0; border-radius: 7px; color: var(--ui-muted, #7b8a6e); background: transparent; padding: 10px 13px; cursor: pointer; }
	button:hover { color: var(--ui-text); background: var(--ui-soft); }
	button[aria-selected="true"] { color: var(--ui-base-ink, #3f5f2e); background: var(--ui-active, #e3ecd6); font-weight: 600; }
	button:focus-visible { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
</style>
