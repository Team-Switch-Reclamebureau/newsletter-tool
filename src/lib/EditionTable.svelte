<script lang="ts">
	import { serializeNewsletter, type Newsletter } from './newsletters';

	let { editions, onOpen, onClone, onDelete, deletingId, deletionDisabled }: {
		editions: {
			newsletter: Newsletter;
			revision: number;
			snapshot: string | null;
			saving: boolean;
			error: string;
		}[];
		onOpen: (id: string) => void;
		onClone: (id: string) => void;
		onDelete: (id: string) => void;
		deletingId: string | null;
		deletionDisabled: boolean;
	} = $props();
	let search = $state('');
	let sort = $state('updated-desc');
	const visible = $derived(editions.filter((entry) => entry.newsletter.name.toLowerCase().includes(search.trim().toLowerCase()))
		.toSorted((a, b) => {
			const comparison = sort.startsWith('name')
				? a.newsletter.name.localeCompare(b.newsletter.name, undefined, { numeric: true, sensitivity: 'base' })
				: Date.parse(a.newsletter.updatedAt) - Date.parse(b.newsletter.updatedAt);
			return (sort.endsWith('desc') ? -comparison : comparison)
				|| a.newsletter.id.localeCompare(b.newsletter.id);
		}));

	function status(entry: (typeof editions)[number]) {
		if (entry.saving) return 'Saving...';
		if (entry.error) return 'Save failed';
		if (!entry.revision) return 'New draft';
		return serializeNewsletter(entry.newsletter) !== entry.snapshot ? 'Unsaved changes' : 'Saved';
	}
</script>

<section class="editions-panel" aria-label="Campaign overview">
	<div class="table-heading">
		<div><h2>Campaigns</h2><p>Open a campaign to edit it, or clone it to create a new variation.</p></div>
		<span>{editions.length} {editions.length === 1 ? 'campaign' : 'campaigns'}</span>
	</div>
	{#if editions.length}
		<div class="table-controls">
			<div class="control"><label for="edition-search">Search campaigns</label><input id="edition-search" type="search" bind:value={search} placeholder="Search by name" /></div>
			<div class="control"><label for="edition-sort">Sort campaigns</label><select id="edition-sort" bind:value={sort}>
				<option value="updated-desc">Recently saved first</option>
				<option value="updated-asc">Oldest saved first</option>
				<option value="name-asc">Name A-Z</option>
				<option value="name-desc">Name Z-A</option>
			</select></div>
			<p role="status">Showing {visible.length} of {editions.length} campaigns</p>
		</div>
		<div class="table-scroll" role="region" aria-label="Campaigns table">
			<table aria-label="Campaigns">
				<thead><tr><th scope="col">Campaign</th><th scope="col">Save status</th><th scope="col">Last saved</th><th scope="col">Actions</th></tr></thead>
				<tbody>
					{#each visible as entry (entry.newsletter.id)}
						<tr>
							<td class="edition-name">{entry.newsletter.name || 'Untitled campaign'}{#if entry.error}<p class="save-error" role="alert">{entry.error}</p>{/if}</td>
							<td><span class="status" class:pending={status(entry) !== 'Saved'}>{status(entry)}</span></td>
							<td>{#if entry.revision}<time datetime={entry.newsletter.updatedAt}>{new Date(entry.newsletter.updatedAt).toLocaleString()}</time>{:else}Not saved yet{/if}</td>
							<td><div class="row-actions">
								<button onclick={() => onOpen(entry.newsletter.id)} disabled={deletingId === entry.newsletter.id} aria-label={`Open campaign ${entry.newsletter.name || 'Untitled campaign'}`}>Open</button>
								<button onclick={() => onClone(entry.newsletter.id)} disabled={entry.saving || deletingId === entry.newsletter.id} aria-label={`Clone campaign ${entry.newsletter.name || 'Untitled campaign'}`}>Clone</button>
								<button class="delete" onclick={() => onDelete(entry.newsletter.id)} disabled={deletionDisabled || entry.saving} aria-label={`Delete campaign ${entry.newsletter.name || 'Untitled campaign'}`}>{deletingId === entry.newsletter.id ? 'Deleting...' : 'Delete'}</button>
							</div></td>
						</tr>
					{:else}
						<tr><td colspan="4" class="empty">No campaigns match your search. <button onclick={() => search = ''}>Clear search</button></td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="empty">No campaigns yet. Click New campaign to create your first campaign.</p>
	{/if}
</section>

<style>
	.editions-panel { background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #dce2d4); border-radius: 12px; box-shadow: var(--ui-shadow); overflow: hidden; }
	.table-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px; border-bottom: 1px solid var(--ui-border, #e1e8d8); }
	h2 { font: 600 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; color: var(--ui-text, #34492c); }
	p { color: var(--ui-muted, #7a886e); font-size: 12px; line-height: 1.8; margin: 8px 0 0; }
	.table-heading > span { color: var(--ui-muted, #78886b); font-size: 11px; white-space: nowrap; }
	.table-controls { display: flex; align-items: end; flex-wrap: wrap; gap: 16px; padding: 18px 22px; }
	.control { display: flex; flex-direction: column; gap: 8px; }
	label { color: var(--ui-text, #5e7450); font-size: 11px; font-weight: 600; }
	.control:first-child { flex: 1; min-width: 180px; }
	input, select { border: 1px solid var(--ui-border, #d4dec8); background: white; color: var(--ui-text, #34492c); border-radius: 5px; padding: 10px; font: inherit; font-size: 12px; min-width: 0; }
	.table-controls p { padding-bottom: 8px; font-size: 11px; }
	.table-scroll { overflow-x: auto; }
	table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 12px; color: var(--ui-text, #526348); }
	th, td { text-align: left; padding: 15px 18px; border-top: 1px solid var(--ui-border, #e1e8d8); vertical-align: middle; }
	th { background: var(--ui-soft, #eef3e6); color: var(--ui-text, #5e7450); font-size: 11px; font-weight: 600; }
	td.edition-name { width: 35%; font-weight: 600; overflow-wrap: anywhere; }
	tbody tr:hover { background: var(--ui-soft, #f6f9f0); }
	time { font-size: 11px; }
	.status { display: inline-block; color: var(--ui-text, #537a37); background: var(--ui-soft, #edf4e3); border-radius: 4px; padding: 5px 7px; font-size: 10px; white-space: nowrap; }
	.status.pending { color: #806c3c; background: #f8f2df; }
	.row-actions { display: flex; gap: 8px; }
	.delete { color: #9b4335; }
	button { color: var(--ui-text, #536a45); background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #d3ddc8); border-radius: 5px; padding: 8px 11px; font-size: 11px; }
	.empty { text-align: center; padding: 30px 22px; }
	.save-error { color: #9b4335; font-weight: 400; }
	@media (max-width: 640px) { .table-heading { align-items: start; } .table-controls { padding: 16px; } .control { width: 100%; } }
</style>
