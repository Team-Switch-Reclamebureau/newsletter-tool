<script lang="ts">
	import WorkspaceSidebar from './WorkspaceSidebar.svelte';
	import UserMenu from './UserMenu.svelte';
	import type { RemoteProject } from './remote';
	import type { EmailSignature } from './signatures';

	let { open = $bindable(false), applicationName, projects, signatures, selectedProjectId = '', selectedSignatureId = '', user, isAdmin, signingOut, onSignOut, onSelectProject, onCreateProject }: {
		open?: boolean;
		applicationName: string;
		projects: RemoteProject[];
		signatures: EmailSignature[];
		selectedProjectId?: string;
		selectedSignatureId?: string;
		user: { name: string; email: string } | null;
		isAdmin: boolean;
		signingOut: boolean;
		onSignOut: () => void;
		onSelectProject?: (id: string) => void;
		onCreateProject?: () => void;
	} = $props();
</script>

<WorkspaceSidebar bind:open>
	<a href="/" class="brand">{applicationName}<span>.</span></a>
	<div class="heading"><a href="/">NEWSLETTERS</a><span>{projects.length}</span></div>
	<nav aria-label="Newsletters">
		{#each projects as project (project.id)}
			{#if onSelectProject}
				<button class:chosen={selectedProjectId === project.id} aria-current={selectedProjectId === project.id ? 'page' : undefined} onclick={() => onSelectProject?.(project.id)}>▤ <span>{project.name}</span></button>
			{:else}
				<a href={`/?project=${project.id}`} class:chosen={selectedProjectId === project.id}>▤ <span>{project.name}</span></a>
			{/if}
		{/each}
	</nav>
	{#if onCreateProject}
		<button class="secondary new-entry" onclick={onCreateProject}>+ New newsletter</button>
	{:else}
		<a class="secondary new-entry" href="/?new=1">+ New newsletter</a>
	{/if}
	<div class="heading signature-heading"><a href="/signatures">SIGNATURES</a><span>{signatures.length}</span></div>
	<nav aria-label="Email signatures">
		{#each signatures as signature (signature.id)}
			<a href={`/signatures?signature=${signature.id}`} class:chosen={selectedSignatureId === signature.id} aria-current={selectedSignatureId === signature.id ? 'page' : undefined}>▤ <span>{signature.name}</span></a>
		{/each}
	</nav>
	<a class="secondary new-entry" href="/signatures?new=1">+ New signature</a>
	<div class="sidebar-footer">
		{#if user}<UserMenu name={user.name} email={user.email} {isAdmin} {signingOut} {onSignOut} />{/if}
	</div>
</WorkspaceSidebar>

<style>
	.brand { display: block; font-size: 27px; font-weight: 750; letter-spacing: -1px; color: var(--ui-base-ink, #425f30); text-decoration: none; margin-bottom: 32px; overflow-wrap: anywhere; }
	.brand span { color: var(--ui-accent, #839e5d); }
	.heading { display: flex; justify-content: space-between; font-size: 10px; color: var(--ui-muted, #7b8971); letter-spacing: 1px; margin: 4px 8px 15px; }
	.heading a { color: inherit; text-decoration: none; }
	.signature-heading { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--ui-border, #dce1d6); }
	nav { min-height: 0; overflow-y: auto; }
	nav button, nav a { width: 100%; display: flex; gap: 9px; background: transparent; border: 0; padding: 12px; text-align: left; color: var(--ui-muted, #6d7a60); border-radius: 8px; margin-bottom: 5px; font-size: 13px; text-decoration: none; }
	nav button:hover, nav a:hover { background: var(--ui-soft); color: var(--ui-text); }
	nav span { overflow-wrap: anywhere; min-width: 0; }
	nav button.chosen, nav a.chosen { background: var(--ui-active, #dce7ce); color: var(--ui-base-ink, #35502d); font-weight: 600; }
	.new-entry { margin-top: 13px; text-align: center; }
	.sidebar-footer { margin-top: auto; padding-top: 32px; }
	@media (max-width: 640px) { .brand { margin-bottom: 20px; } .sidebar-footer { padding-top: 20px; } }
</style>
