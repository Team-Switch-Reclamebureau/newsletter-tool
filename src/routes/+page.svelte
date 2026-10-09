<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import type { PageData } from './$types';
	import NewsletterEditor from '#lib/NewsletterEditor.svelte';
	import NewsletterPreview from '#lib/NewsletterPreview.svelte';
	import EditionTable from '#lib/EditionTable.svelte';
	import { jsonRequest, requestJson } from '#lib/api-client.js';
	import { cloneNewsletter, composeNewsletter, createItem, createNewsletter, parseNewsletter, serializeNewsletter, type Newsletter } from '#lib/newsletters.js';
	import { readSource } from '#lib/files.js';
	import { uploadImages, type ImageUploadResult } from '#lib/image-uploads.js';
	import { MAX_IMAGE_BYTES, UUID_PATTERN, type ImageAsset, type ImageScope, type RemoteProject } from '#lib/remote.js';
	import { EMPTY_UTM, UTM_KEYS } from '#lib/utm.js';

	interface Draft {
		newsletter: Newsletter;
		permalink: string | null;
		revision: number;
		snapshot: string | null;
		saving: boolean;
		error: string;
		editionAssets: ImageAsset[];
		cloneSourceId?: string;
	}
	interface ProjectContext {
		project: RemoteProject;
		name: string;
		template: string;
		snippet: string;
		projectSnapshot: string;
		drafts: Draft[];
		activeId: string | null;
		assets: ImageAsset[];
		templateSaving: boolean;
		uploading: boolean;
		libraryUploadTotal: number;
		libraryUploads: ImageUploadResult[];
		libraryUploadDestination: string;
		deletingAssetId: string | null;
		deletingEditionId: string | null;
		message: string;
	}
	type Mode = 'editions' | 'templates' | 'project-images'
		| 'content' | 'edition-settings' | 'edition-images';

	let { data }: { data: PageData } = $props();
	let projects = $state<RemoteProject[]>([]);
	let contexts = $state<Record<string, ProjectContext>>({});
	let projectId = $state('');
	let mode = $state<Mode>('editions');
	let loading = $state(false);
	let apiError = $state('');
	let newProject = $state(false);
	let projectName = $state('');
	let creatingProject = $state(false);
	let newEdition = $state(false);
	let editionName = $state('');
	let cloneSourceId = $state<string | null>(null);
	let memberEmail = $state('');
	let addingMember = $state(false);
	let leaving = false;
	let selectionVersion = 0;
	const context = $derived(contexts[projectId]);
	const currentDeletion = $derived(context?.deletingEditionId !== null && context?.deletingEditionId !== undefined);
	const selected = $derived(projects.find((project) => project.id === projectId));
	const draft = $derived(context?.drafts.find((entry) => entry.newsletter.id === context.activeId));
	const editionView = $derived(mode === 'content' || mode === 'edition-settings' || mode === 'edition-images');
	const availableAssets = $derived([...(context?.assets ?? []), ...(draft?.editionAssets ?? [])].filter((asset) => asset.id !== context?.deletingAssetId));
	const libraryAssets = $derived(editionView ? draft?.editionAssets ?? [] : context?.assets ?? []);
	const localImageReferences = $derived.by(() => {
		const ids = new Set<string>();
		for (const current of Object.values(contexts)) {
			const sources = [current.template, current.snippet];
			for (const entry of current.drafts) {
				sources.push(serializeNewsletter(entry.newsletter));
				for (const item of entry.newsletter.items) if (item.imageAssetId) ids.add(item.imageAssetId);
			}
			for (const source of sources) {
				for (const match of source.matchAll(/\/media\/([a-f0-9-]{36})\.webp/gi)) {
					if (UUID_PATTERN.test(match[1])) ids.add(match[1].toLowerCase());
				}
			}
		}
		return ids;
	});
	const composition = $derived(context ? composeNewsletter(context.template, context.snippet || null, editionView ? draft?.newsletter ?? null : null) : { source: '', error: null });
	const dirty = $derived(draft ? serializeNewsletter(draft.newsletter) !== draft.snapshot : false);
	const templateDirty = $derived(context ? templateSnapshot(context) !== context.projectSnapshot : false);
	const unsaved = $derived(Object.values(contexts).some((value) =>
		templateSnapshot(value) !== value.projectSnapshot
		|| value.drafts.some((entry) => serializeNewsletter(entry.newsletter) !== entry.snapshot)));

	$effect(() => { projects = data.projects.map((project) => ({ ...project })); });
	$effect(() => { if (data.user && projects.length && !projectId) void selectProject(projects[0].id); });

	beforeNavigate((navigation) => {
		if (unsaved && !leaving && !window.confirm('You have unsaved changes. Leave this workspace and discard them?')) navigation.cancel();
	});

	function beforeUnload(event: BeforeUnloadEvent) {
		if (unsaved) { event.preventDefault(); event.returnValue = ''; }
	}

	function templateSnapshot(value: Pick<ProjectContext, 'name' | 'template' | 'snippet'>) {
		return JSON.stringify({ name: value.name, template: value.template, snippet: value.snippet });
	}

	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : 'The operation failed. Please try again.';
	}

	async function selectProject(id: string) {
		const version = ++selectionVersion;
		projectId = id;
		apiError = '';
		newEdition = false;
		cloneSourceId = null;
		memberEmail = '';
		if (contexts[id]) { loading = false; mode = 'editions'; return; }
		loading = true;
		try {
			const [editions, images] = await Promise.all([
				requestJson<{ newsletters: { newsletter: Newsletter; revision: number; permalink: string }[] }>(`/api/projects/${id}/newsletters`),
				requestJson<{ assets: ImageAsset[]; editionAssets: Record<string, ImageAsset[]> }>(`/api/projects/${id}/assets?includeEditions=true`)
			]);
			if (version !== selectionVersion) return;
			const project = projects.find((project) => project.id === id);
			if (!project) throw new Error('This project is no longer available. Reload the workspace.');
			const fields = { name: project.name, template: project.template, snippet: project.itemTemplate ?? '' };
			contexts[id] = {
				project, ...fields, projectSnapshot: templateSnapshot(fields),
				drafts: editions.newsletters.map((entry) => ({
					...entry, snapshot: serializeNewsletter(entry.newsletter), saving: false, error: '',
					editionAssets: images.editionAssets[entry.newsletter.id] ?? []
				})),
				activeId: null,
				assets: images.assets,
				templateSaving: false, uploading: false, libraryUploadTotal: 0, libraryUploads: [],
				libraryUploadDestination: '',
				deletingAssetId: null, deletingEditionId: null,
				message: ''
			};
			mode = 'editions';
		} catch (cause) { if (version === selectionVersion) apiError = message(cause); }
		finally { if (version === selectionVersion) loading = false; }
	}

	async function createProject(event: SubmitEvent) {
		event.preventDefault();
		creatingProject = true;
		apiError = '';
		try {
			const result = await requestJson<{ project: RemoteProject }>('/api/projects', jsonRequest('POST', { name: projectName }));
			projects = [...projects, result.project];
			projectName = '';
			newProject = false;
			await selectProject(result.project.id);
		} catch (cause) { apiError = message(cause); }
		finally { creatingProject = false; }
	}

	function selectEdition(id: string) {
		if (!context) return;
		context.activeId = id;
		mode = 'content';
		newEdition = false;
		cloneSourceId = null;
	}

	function beginEdition(id: string | null = null) {
		const source = context?.drafts.find((entry) => entry.newsletter.id === id);
		if (id && !source) { apiError = 'The source edition is no longer available. Reload the project before cloning.'; return; }
		cloneSourceId = source?.newsletter.id ?? null;
		editionName = source ? `${source.newsletter.name.slice(0, 155)} copy` : '';
		newEdition = true;
	}

	async function deleteEdition(id: string) {
		const current = context;
		const entry = current?.drafts.find((value) => value.newsletter.id === id);
		if (!current || !entry) return;
		apiError = '';
		if (current.deletingEditionId || current.uploading || current.deletingAssetId || current.templateSaving || current.drafts.some((value) => value.saving)) {
			apiError = 'Wait for the current edition or image operation before deleting.';
			return;
		}
		if (entry.revision && current.drafts.some((value) => !value.revision && value.cloneSourceId === id)) {
			apiError = 'Save or delete this edition’s unsaved clones before deleting their source.';
			return;
		}
		if (entry.revision) {
			const sources = Object.values(contexts).flatMap((value) => [
				...(value.template !== value.project.template || value.snippet !== (value.project.itemTemplate ?? '') ? [value.template, value.snippet] : []),
				...value.drafts.filter((value) => value !== entry && serializeNewsletter(value.newsletter) !== value.snapshot).map((value) => serializeNewsletter(value.newsletter))
			]);
			if (entry.editionAssets.some((asset) => sources.some((source) => source.includes(`/media/${asset.id}.webp`) || source.includes(`"imageAssetId": "${asset.id}"`)))) {
				apiError = 'This edition’s images are referenced in another draft or a template. Save those changes or remove the references before deleting.';
				return;
			}
		}
		if (!window.confirm(`Delete edition "${entry.newsletter.name || 'Untitled newsletter'}"? Its content and unsaved changes will be discarded, and its public HTML link will stop working. Images used by other current editions or templates will be kept. Unused edition-only image files will be permanently deleted.`)) return;
		current.deletingEditionId = id;
		try {
			if (entry.revision) {
				const result = await requestJson<{ deletedAssetIds: string[]; message: string }>(`/api/projects/${current.project.id}/newsletters/${id}`, jsonRequest('DELETE', { revision: entry.revision }));
				for (const value of current.drafts) value.editionAssets = value.editionAssets.filter((asset) => !result.deletedAssetIds.includes(asset.id));
				current.message = result.message;
			} else current.message = 'Unsaved edition discarded.';
			current.drafts = current.drafts.filter((value) => value !== entry);
			if (current.activeId === id) current.activeId = null;
			if (context === current) {
				mode = 'editions';
				newEdition = false;
				cloneSourceId = null;
			}
		} catch (cause) { apiError = message(cause); }
		finally { current.deletingEditionId = null; }
	}

	function addDraft(newsletter: Newsletter, current = context, source?: Draft) {
		if (!current) return;
		current.drafts.push({
			newsletter, permalink: null, revision: 0, snapshot: null, saving: false, error: '',
			editionAssets: [...(source?.editionAssets ?? [])],
			cloneSourceId: source?.revision ? source.newsletter.id : source?.cloneSourceId
		});
		current.activeId = newsletter.id;
		if (context === current) {
			mode = 'content';
			newEdition = false;
			cloneSourceId = null;
			editionName = '';
		}
	}

	function createEdition(event: SubmitEvent) {
		event.preventDefault();
		if (!context || !editionName.trim()) return;
		if (cloneSourceId) {
			const source = context.drafts.find((entry) => entry.newsletter.id === cloneSourceId);
			if (!source) { apiError = 'The source edition is no longer available. Choose an edition to clone again.'; return; }
			addDraft(cloneNewsletter(source.newsletter, editionName), context, source);
			context.message = 'Edition cloned as a new draft. Save it to persist it on the server.';
		} else addDraft(createNewsletter(editionName));
	}

	async function saveEdition() {
		if (!context || !draft || draft.saving || currentDeletion) return;
		const current = context;
		const entry = draft;
		entry.error = '';
		entry.saving = true;
		const submitted = serializeNewsletter(entry.newsletter);
		try {
			parseNewsletter(submitted);
			const path = `/api/projects/${current.project.id}/newsletters${entry.revision ? `/${entry.newsletter.id}` : ''}`;
			const result = await requestJson<{ newsletter: Newsletter; revision: number; permalink: string; editionAssets?: ImageAsset[] }>(path, jsonRequest(entry.revision ? 'PATCH' : 'POST', {
				newsletter: JSON.parse(submitted), revision: entry.revision, cloneSourceId: entry.cloneSourceId
			}));
			entry.revision = result.revision;
			entry.permalink = result.permalink;
			entry.cloneSourceId = undefined;
			if (result.editionAssets) entry.editionAssets = result.editionAssets;
			entry.snapshot = serializeNewsletter(result.newsletter);
			if (serializeNewsletter(entry.newsletter) === submitted) entry.newsletter = result.newsletter;
			else entry.newsletter = { ...entry.newsletter, createdAt: result.newsletter.createdAt, updatedAt: result.newsletter.updatedAt };
			current.message = 'Newsletter saved. Its HTML permalink now reflects the latest saved edition.';
		} catch (cause) { entry.error = message(cause); }
		finally { entry.saving = false; }
	}

	function exportEdition() {
		if (!draft) return;
		try {
			const contents = serializeNewsletter(draft.newsletter);
			parseNewsletter(contents);
			const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = `${draft.newsletter.id}.json`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (cause) { draft.error = message(cause); }
	}

	async function importEdition(input: HTMLInputElement) {
		const file = input.files?.[0];
		const current = context;
		if (!file || !current) return;
		apiError = '';
		try {
			const newsletter = parseNewsletter(await readSource(file));
			const source = current.drafts.find((entry) => entry.newsletter.id === newsletter.id);
			addDraft({ ...newsletter, id: crypto.randomUUID() }, current, source);
		} catch (cause) { apiError = message(cause); }
		finally { input.value = ''; }
	}

	async function loadTemplate(input: HTMLInputElement, target: 'template' | 'snippet') {
		const file = input.files?.[0];
		const current = context;
		if (!file || !current) return;
		apiError = '';
		try { current[target] = await readSource(file); }
		catch (cause) { apiError = message(cause); }
		finally { input.value = ''; }
	}

	async function saveTemplates(event: SubmitEvent) {
		event.preventDefault();
		if (!context || context.templateSaving) return;
		const current = context;
		current.templateSaving = true;
		apiError = '';
		const submitted = templateSnapshot(current);
		try {
			const result = await requestJson<{ project: RemoteProject }>(`/api/projects/${current.project.id}`, jsonRequest('PATCH', {
				name: current.name, template: current.template, itemTemplate: current.snippet || null, revision: current.project.revision
			}));
			current.project = result.project;
			current.projectSnapshot = templateSnapshot({ name: result.project.name, template: result.project.template, snippet: result.project.itemTemplate ?? '' });
			if (templateSnapshot(current) === submitted) {
				current.name = result.project.name;
				current.template = result.project.template;
				current.snippet = result.project.itemTemplate ?? '';
			}
			projects = projects.map((project) => project.id === result.project.id ? result.project : project);
			current.message = 'Project settings and templates saved.';
		} catch (cause) { apiError = message(cause); }
		finally { current.templateSaving = false; }
	}

	async function storeImage(current: ProjectContext, file: File, edition?: Draft): Promise<ImageAsset> {
		if (edition && !edition.revision) throw new Error('Save this edition before uploading edition images.');
		if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image no larger than 5 MB.');
		const form = new FormData();
		form.set('image', file);
		const suffix = edition ? `?newsletterId=${edition.newsletter.id}` : '';
		const result = await requestJson<{ asset: ImageAsset }>(`/api/projects/${current.project.id}/assets${suffix}`, { method: 'POST', body: form });
		if (edition) edition.editionAssets = [result.asset, ...edition.editionAssets];
		else current.assets = [result.asset, ...current.assets];
		return result.asset;
	}

	async function uploadImage(current: ProjectContext, file: File, edition?: Draft): Promise<ImageAsset> {
		if (current.uploading || current.deletingAssetId || current.deletingEditionId) throw new Error('An image or edition operation is already in progress. Please wait.');
		current.uploading = true;
		current.libraryUploadTotal = 0;
		current.libraryUploads = [];
		try {
			const asset = await storeImage(current, file, edition);
			current.message = 'Image uploaded. Its public URL will remain unchanged.';
			return asset;
		} finally { current.uploading = false; }
	}

	async function uploadItemImage(newsletterId: string, itemId: string, file: File, scope: ImageScope) {
		const current = context;
		if (!current) throw new Error('Choose a project first.');
		const entry = current.drafts.find((entry) => entry.newsletter.id === newsletterId);
		if (scope === 'edition' && !entry?.revision) throw new Error('Save this edition before uploading edition images.');
		const asset = await uploadImage(current, file, scope === 'edition' ? entry : undefined);
		if (!entry?.newsletter.items.some((item) => item.id === itemId)) {
			current.message = 'Image uploaded to the library. The original item no longer exists.';
			return;
		}
		entry.newsletter.items = entry.newsletter.items.map((item) => item.id === itemId ? { ...item, image: asset.url, imageAssetId: asset.id } : item);
	}

	async function uploadLibraryImages(input: HTMLInputElement) {
		const files = Array.from(input.files ?? []);
		const current = context;
		if (!files.length || !current) return;
		apiError = '';
		if (current.uploading || current.deletingAssetId || current.deletingEditionId) { apiError = 'An image or edition operation is already in progress. Please wait.'; input.value = ''; return; }
		const edition = editionView ? draft : undefined;
		if (editionView && !edition?.revision) {
			apiError = 'Open and save an edition before uploading edition images.';
			input.value = '';
			return;
		}
		current.uploading = true;
		current.libraryUploadTotal = files.length;
		current.libraryUploads = [];
		current.libraryUploadDestination = edition ? `Edition: ${edition.newsletter.name}` : 'Project images';
		current.message = '';
		try {
			await uploadImages(files, (file) => storeImage(current, file, edition), (result) => {
				current.libraryUploads = [...current.libraryUploads, result];
			});
		}
		catch (cause) { apiError = message(cause); }
		finally { current.uploading = false; input.value = ''; }
	}

	function imageUsedInDrafts(asset: ImageAsset) {
		return localImageReferences.has(asset.id);
	}

	async function deleteLibraryImage(asset: ImageAsset) {
		const current = context;
		if (!current) return;
		apiError = '';
		if (current.uploading || current.deletingAssetId || current.deletingEditionId) { apiError = 'An image or edition operation is already in progress. Please wait.'; return; }
		const edition = editionView ? draft : undefined;
		if (editionView && !edition?.revision) {
			apiError = 'Save this edition before removing images from its library.';
			return;
		}
		if (imageUsedInDrafts(asset)) {
			apiError = 'This image is used in edition content or a template. Remove those references and save before deleting it.';
			return;
		}
		if (!window.confirm(`Delete "${asset.filename}" from ${edition ? `edition "${edition.newsletter.name}"` : 'the project library'}? Its file will be permanently deleted if no other libraries use it. Images used in current saved editions or templates are protected. Previously imported Mailchimp campaigns do not protect unused files.`)) return;
		current.deletingAssetId = asset.id;
		try {
			const suffix = edition ? `?newsletterId=${edition.newsletter.id}` : '';
			const result = await requestJson<{ fileDeleted: boolean; message: string }>(`/api/projects/${current.project.id}/assets/${asset.id}${suffix}`, { method: 'DELETE' });
			if (result.fileDeleted) {
				for (const value of Object.values(contexts)) {
					value.assets = value.assets.filter((image) => image.id !== asset.id);
					for (const entry of value.drafts) entry.editionAssets = entry.editionAssets.filter((image) => image.id !== asset.id);
				}
			} else if (edition) {
				edition.editionAssets = edition.editionAssets.filter((image) => image.id !== asset.id);
				for (const entry of current.drafts) {
					if (!entry.revision && entry.cloneSourceId === edition.newsletter.id) {
						entry.editionAssets = entry.editionAssets.filter((image) => image.id !== asset.id);
					}
				}
			}
			current.message = result.message;
		} catch (cause) { apiError = `${asset.filename}: ${message(cause)}`; }
		finally { current.deletingAssetId = null; }
	}

	async function addMember(event: SubmitEvent) {
		event.preventDefault();
		if (!context) return;
		addingMember = true;
		apiError = '';
		try {
			const result = await requestJson<{ message: string }>(`/api/projects/${context.project.id}/members`, jsonRequest('POST', { email: memberEmail }));
			context.message = result.message;
			memberEmail = '';
		} catch (cause) { apiError = message(cause); }
		finally { addingMember = false; }
	}

	async function copyPermalink(id: string) {
		const current = context;
		const entry = current?.drafts.find((entry) => entry.newsletter.id === id);
		apiError = '';
		if (!current || !entry?.permalink) { apiError = 'Save the edition first to create its HTML permalink.'; return; }
		if (!navigator.clipboard?.writeText) { apiError = 'Clipboard access is unavailable. Open the edition and select its HTML permalink to copy it manually.'; return; }
		try {
			await navigator.clipboard.writeText(entry.permalink);
			current.message = 'Public HTML permalink copied. Save edition or template changes to update the HTML at this same URL.';
		} catch (cause) { apiError = message(cause); }
	}

	async function reloadProject() {
		if (currentDeletion) { apiError = 'Wait for edition deletion to finish before reloading.'; return; }
		if (unsaved && !window.confirm('Export any drafts you want to keep. Reloading discards unsaved changes in the selected project. Continue?')) return;
		apiError = '';
		try {
			const result = await requestJson<{ projects: RemoteProject[] }>('/api/projects');
			projects = result.projects;
			delete contexts[projectId];
			await selectProject(projectId);
		} catch (cause) { apiError = message(cause); }
	}

	async function logout() {
		if (unsaved && !window.confirm('Sign out and discard unsaved changes?')) return;
		apiError = '';
		try {
			await requestJson('/api/auth/sign-out', jsonRequest('POST', {}));
			leaving = true;
			contexts = {};
			await goto('/login', { invalidateAll: true });
		} catch (cause) { apiError = message(cause); }
	}
</script>

<svelte:window onbeforeunload={beforeUnload} />
<svelte:head><title>{data.settings.applicationName} — Newsletter workspace</title><meta name="description" content="Your self-hosted newsletter projects, editions, and images." /></svelte:head>

{#if !data.configured}
	<main class="setup">
		<div class="brand">{data.settings.applicationName}<span>.</span></div>
		<section class="panel setup-card">
			<div class="eyebrow">YOUR SELF-HOSTED NEWSLETTER STUDIO</div>
			<h1>Give your stories a home.</h1>
			<p>The hosted workspace needs PostgreSQL and its server configuration before you can sign in.</p>
			<ol><li>Configure <code>DATABASE_URL</code>, <code>BETTER_AUTH_SECRET</code>, and <code>APP_ORIGIN</code>.</li><li>Run <code>npm run db:migrate</code>.</li><li>Provision an account with <code>npm run user:create -- email "Name"</code>.</li></ol>
			<p>Docker Compose, Caddy, persistent image storage, and setup instructions are included in the repository.</p>
		</section>
	</main>
{:else}
	<div class="app">
		<aside>
			<a href="/" class="brand">{data.settings.applicationName}<span>.</span></a>
			<div class="eyebrow">YOUR WORKSPACE</div>
			<div class="workspace-card"><strong>{data.user?.name}</strong><small>{data.user?.email}</small></div>
			<div class="project-heading"><span>PROJECTS</span><span>{projects.length}</span></div>
			<nav aria-label="Newsletter projects">{#each projects as project (project.id)}<button class:chosen={projectId === project.id} onclick={() => selectProject(project.id)}>▤ <span>{project.name}</span></button>{/each}</nav>
			<button class="secondary new-project" onclick={() => newProject = true}>+ New project</button>
			<div class="sidebar-footer">
				<a class="admin-settings" href="/account">Change password</a>
				{#if data.isAdmin}<a class="admin-settings" href="/admin">Admin settings</a>{/if}
				<small>Private projects · Public HTML and images</small>
				<button class="secondary" onclick={logout}>Sign out</button>
			</div>
		</aside>
		<main class="workspace">
			<header class:project-header={!!selected}><span>Workspace / <strong>{selected?.name || 'Getting started'}</strong></span><span class="badge">TEAM SWITCH MJML STUDIO</span></header>
			{#if !selected}
				<div class="page-heading"><div><div class="eyebrow">A LITTLE LESS WORK. A BETTER EMAIL.</div><h1>Your next newsletter starts here<span>.</span></h1><p>One template. A new story with every edition.</p></div></div>
			{/if}
			{#if apiError}<p class="error notice" role="alert">{apiError}</p>{/if}
			{#if newProject}
				<form class="inline-form panel" onsubmit={createProject}><label for="project-name">Project name</label><input id="project-name" bind:value={projectName} maxlength="160" required /><button class="primary" disabled={creatingProject || !projectName.trim()}>{creatingProject ? 'Creating…' : 'Create project'}</button><button class="secondary" type="button" onclick={() => newProject = false}>Cancel</button></form>
			{/if}
			{#if loading}<p role="status">Loading project…</p>
			{:else if !context}
				<section class="panel empty-state"><h2>A place for every project.</h2><p>Create a project to start with a ready-to-use MJML template, or import your own template afterwards.</p><button class="primary" onclick={() => newProject = true}>Create your first project</button>{#if selected}<button class="secondary" onclick={reloadProject}>Reload project</button>{/if}</section>
			{:else}
				{#if draft && editionView}
				<section class="edition-bar" aria-label="Selected newsletter">
					<div class="selected-edition"><button class="secondary" onclick={() => mode = 'editions'}>All editions</button><strong>{draft.newsletter.name || 'Untitled newsletter'}</strong><button class="secondary" onclick={() => beginEdition(draft.newsletter.id)} disabled={draft.saving || currentDeletion}>Clone edition</button><button class="secondary delete-image" onclick={() => deleteEdition(draft.newsletter.id)} disabled={draft.saving || currentDeletion || context.uploading || context.deletingAssetId !== null}>Delete edition</button></div>
					<div class="save-actions">
						{#if draft}<span role="status">{draft.saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved to server'}</span><button class="primary" onclick={saveEdition} disabled={draft.saving || currentDeletion}>{draft.saving ? 'Saving…' : 'Save newsletter'}</button><button class="secondary" onclick={exportEdition}>Export JSON</button>{/if}
					</div>
				</section>
				<section class="edition-export" aria-label="Edition HTML export">
					{#if draft.permalink}
						<label for="html-permalink">Public HTML permalink</label>
						<div class="export-actions"><input id="html-permalink" value={draft.permalink} readonly onfocus={(event) => event.currentTarget.select()} /><button class="secondary" onclick={() => copyPermalink(draft.newsletter.id)}>Copy link</button><a class="secondary" href={draft.permalink} target="_blank" rel="noreferrer">Open HTML</a><a class="secondary" href={draft.permalink} download={`${draft.newsletter.id}.html`}>Download HTML</a></div>
						<p>Always uses the latest saved edition, UTM settings, and project templates. Anyone with this link can access the HTML. Mailchimp must be able to reach this URL from the internet.</p>
					{:else}<p>Save this edition to create its public HTML permalink.</p>{/if}
				</section>
				{/if}
				{#if newEdition}<form class="inline-form panel" onsubmit={createEdition}><label for="edition-name">{cloneSourceId ? 'Cloned edition name' : 'Newsletter name'}</label><input id="edition-name" bind:value={editionName} maxlength="160" required /><button class="primary" disabled={!editionName.trim()}>{cloneSourceId ? 'Clone newsletter' : 'Create newsletter'}</button><button class="secondary" type="button" onclick={() => { newEdition = false; cloneSourceId = null; }}>Cancel</button></form>{/if}
				{#if draft?.error && editionView}<p class="error notice" role="alert">{draft.error}</p>{/if}
				{#if context.message}<p class="notice success" role="status">{context.message}</p>{/if}
				<div class="project-tools"><div class="view-tabs" aria-label={editionView ? 'Edition views' : 'Project views'}>
					{#if editionView}
						<button class:active={mode === 'content'} onclick={() => mode = 'content'}>Content</button>
						<button class:active={mode === 'edition-settings'} onclick={() => mode = 'edition-settings'}>Settings</button>
						<button class:active={mode === 'edition-images'} onclick={() => mode = 'edition-images'}>Edition images ({draft?.editionAssets.length ?? 0})</button>
					{:else}
						<button class:active={mode === 'editions'} onclick={() => mode = 'editions'}>Editions ({context.drafts.length})</button>
						<button class:active={mode === 'templates'} onclick={() => mode = 'templates'}>Templates</button>
						<button class:active={mode === 'project-images'} onclick={() => mode = 'project-images'}>Project images ({context.assets.length})</button>
					{/if}
				</div><div class="save-actions"><button class="secondary" onclick={reloadProject} disabled={context.templateSaving || context.uploading || context.deletingAssetId !== null || draft?.saving}>Reload project</button>{#if !editionView}<button class="primary" onclick={() => beginEdition()}>+ New newsletter</button>{/if}</div></div>
				{#if mode === 'editions'}
					{#key projectId}<EditionTable editions={context.drafts} onOpen={selectEdition} onClone={beginEdition} onDelete={deleteEdition} onCopyLink={copyPermalink} deletingId={context.deletingEditionId} deletionDisabled={currentDeletion || context.uploading || context.deletingAssetId !== null || context.drafts.some((value) => value.saving)} />{/key}
				{:else if mode === 'edition-settings' && draft}
					<section class="panel library"><h2>Edition settings</h2>
						<form class="utm-form" onsubmit={(event) => { event.preventDefault(); void saveEdition(); }}>
							<h3>UTM link tracking</h3>
							<p>Filled values are added to all HTTP(S) links in this edition, including links in its templates. Other query parameters and fragments are preserved. Images, mailto links, and anchor links are not tracked. Leave values blank to leave those parameters unchanged.</p>
							{#each UTM_KEYS as key (key)}
								<label for={`edition-${key}`}>{key}</label><input id={`edition-${key}`} bind:value={draft.newsletter.utm[key]} maxlength="200" disabled={draft.saving || currentDeletion} placeholder={key === 'utm_source' || key === 'utm_medium' ? 'mail' : key === 'utm_campaign' ? 'nieuwsbrief' : 'october_26'} />
							{/each}
							<p>Saving applies this edition's settings and content changes and updates its HTML permalink. Other editions keep their own values.</p>
							<div class="save-actions"><span>{dirty ? 'Unsaved edition changes' : 'Edition saved'}</span><button class="primary" disabled={draft.saving || currentDeletion}>{draft.saving ? 'Saving…' : 'Save edition settings'}</button></div>
						</form>
					</section>
				{:else if mode === 'project-images' || mode === 'edition-images'}
					<section class="panel library"><h2>{editionView ? 'Edition images' : 'Project images'}</h2><p>{editionView ? 'These images belong to this edition and are inherited by its clones. Shared project images remain available in the content editor.' : 'These images are available in every edition of this project.'} All image URLs remain public for email delivery.</p>
						{#if editionView && draft && !draft.revision}<p>Save this edition before uploading edition images.</p>{/if}
						<p>Select one or more JPEG, PNG, or WebP images. Each image can be up to 5 MB and 20 megapixels. Stored as immutable WebP files with public URLs.</p><label for="library-upload">Upload images</label><input id="library-upload" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={context.uploading || context.deletingAssetId !== null || (editionView && !draft?.revision)} onchange={(event) => uploadLibraryImages(event.currentTarget)} />
						{#if context.libraryUploadTotal}
							<p>Upload results for {context.libraryUploadDestination}</p>
							<p role="status">{#if context.uploading}Uploading images: {context.libraryUploads.length} of {context.libraryUploadTotal} processed.{:else}Upload complete: {context.libraryUploads.filter((result) => result.status === 'uploaded').length} of {context.libraryUploadTotal} uploaded; {context.libraryUploads.filter((result) => result.status === 'failed').length} failed.{/if}</p>
							<ul class="upload-results" aria-label="Image upload results">
								{#each context.libraryUploads as result, index (index)}<li class:upload-failed={result.status === 'failed'}><strong>{result.filename}</strong>: {#if result.status === 'uploaded'}Uploaded{:else}<span role="alert">{result.error}</span>{/if}</li>{/each}
							</ul>
						{:else if context.uploading}<p role="status">Uploading image…</p>{/if}
						<div class="asset-grid">{#each libraryAssets as asset (asset.id)}<article><img src={asset.url} alt={asset.filename} loading="lazy" /><strong>{asset.filename}</strong><small>{asset.width} × {asset.height} · {Math.ceil(asset.bytes / 1024)} KB · {asset.scope === 'edition' ? 'Edition image' : 'Project image'}</small><a href={asset.url} target="_blank" rel="noreferrer">Open public image ↗</a>{#if editionView && draft}<button class="secondary" disabled={context.deletingAssetId !== null} onclick={() => { if (draft) draft.newsletter.items.push({ ...createItem(), image: asset.url, imageAssetId: asset.id }); mode = 'content'; }}>Add as item</button>{/if}
							<button class="secondary delete-image" aria-label={`Delete image ${asset.filename}`} disabled={context.uploading || context.deletingAssetId !== null || imageUsedInDrafts(asset) || (asset.scope === 'edition' && !draft?.revision)} onclick={() => deleteLibraryImage(asset)}>{context.deletingAssetId === asset.id ? 'Deleting…' : 'Delete image'}</button>
							{#if imageUsedInDrafts(asset)}<small>Used in edition content or a template. Remove references and save first.</small>{/if}
						</article>{/each}</div>
						{#if !libraryAssets.length}<p>No images in this library yet. Upload them here or directly from an item.</p>{/if}
					</section>
				{:else}
					<div class="editor-grid">
						<section class="panel editor-panel" aria-label={mode === 'templates' ? 'Project templates' : 'Newsletter editor'}>
							<div class="panel-toolbar"><h2>{mode === 'templates' ? 'Project templates' : 'Newsletter content'}</h2><small>{context.project.role === 'owner' ? 'Owner' : 'Editor'}</small></div>
							{#if mode === 'content' && draft}<NewsletterEditor newsletter={draft.newsletter} template={context.template} snippet={context.snippet || null} assets={availableAssets} canUploadEditionImages={draft.revision > 0} imageUploading={context.uploading || context.deletingAssetId !== null} onUpdate={(newsletter) => { if (draft) { draft.newsletter = newsletter; draft.error = ''; } }} onImageUpload={uploadItemImage} />
							{:else}
								<form class="template-form" onsubmit={saveTemplates}>
									<label for="template-project-name">Project name</label><input id="template-project-name" bind:value={context.name} maxlength="160" required />
									<label for="project-template">Template MJML</label><textarea id="project-template" bind:value={context.template} rows="12" spellcheck="false"></textarea>
									<p>Place exactly one <code>{'{{items}}'}</code> inside mj-body. Use <code>{'{{newsletter_name}}'}</code> for the edition name. Typed tags such as <code>{'{{text:headline}}'}</code> create newsletter-level fields.</p>
									<label for="template-import">Import template.mjml</label><input id="template-import" type="file" accept=".mjml" onchange={(event) => loadTemplate(event.currentTarget, 'template')} />
									<label for="item-template">Item snippet MJML</label><textarea id="item-template" bind:value={context.snippet} rows="8" spellcheck="false" placeholder="Leave empty to use the default item layout."></textarea>
									<p>Use <code>{'{{type:name}}'}</code> for per-item fields. Types: text, textarea, url, image, number. Legacy fields image, image_alt, title, text, button, and url still work in double braces. Upload shared images in Project images or edition-only images in Edition images, then select them in image fields.</p>
									<label for="snippet-import">Import item.mjml</label><input id="snippet-import" type="file" accept=".mjml" onchange={(event) => loadTemplate(event.currentTarget, 'snippet')} />
									<div class="save-actions"><span>{templateDirty ? 'Unsaved project changes' : 'Project saved'}</span><button class="primary" disabled={context.templateSaving}>{context.templateSaving ? 'Saving…' : 'Save templates'}</button></div>
								</form>
								{#if context.project.role === 'owner'}<form class="member-form" onsubmit={addMember}><h3>Share this project</h3><p>Administrators provision accounts first. Add an existing user by email to grant editor access.</p><label for="member-email">Member email</label><input id="member-email" type="email" bind:value={memberEmail} required /><button class="secondary" disabled={addingMember}>{addingMember ? 'Adding…' : 'Add member'}</button></form>{/if}
							{/if}
						</section>
						<NewsletterPreview source={composition.source} error={composition.error ?? ''} name={(editionView ? draft?.newsletter.name : selected?.name) || 'Template'} utm={editionView ? draft?.newsletter.utm ?? EMPTY_UTM : EMPTY_UTM} />
					</div>
				{/if}
				{#if !editionView}<div class="import-edition"><label for="edition-import">Import an existing newsletter JSON</label><input id="edition-import" type="file" accept=".json,application/json" onchange={(event) => importEdition(event.currentTarget)} /></div>{/if}
			{/if}
			<footer>Team Switch © 2026</footer>
		</main>
	</div>
{/if}

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #f6f7f3; color: #25382d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
	:global(button) { font: inherit; cursor: pointer; }
	:global(button:disabled) { cursor: default; opacity: .55; }
	:global(button:focus-visible), :global(a:focus-visible), :global(input:focus-visible), :global(textarea:focus-visible), :global(select:focus-visible) { outline: 2px solid var(--ui-accent, #829e66); outline-offset: 3px; }
	.brand { display: block; font-size: 29px; font-weight: 750; letter-spacing: -1.5px; color: var(--ui-accent, #425f30); text-decoration: none; margin-bottom: 38px; overflow-wrap: anywhere; }
	.brand span, h1 span { color: var(--ui-accent, #839e5d); }
	.eyebrow { font-size: 9px; font-weight: 600; letter-spacing: 1.5px; color: var(--ui-muted, #839273); }
	.app { display: flex; min-height: 100vh; }
	aside { display: flex; flex-direction: column; width: 250px; flex-shrink: 0; background: var(--ui-soft, #eef0e9); border-right: 1px solid var(--ui-border, #dce1d6); padding: 32px 20px 22px; }
	.workspace-card { padding: 14px; border: 1px solid var(--ui-border, #d2d9c9); border-radius: 8px; margin-top: 15px; overflow-wrap: anywhere; background: var(--ui-surface, #f7f9f2); }
	.workspace-card strong { font-size: 12px; }
	.workspace-card small { display: block; font-size: 10px; color: var(--ui-muted, #829075); margin-top: 6px; }
	.project-heading { display: flex; justify-content: space-between; font-size: 10px; color: var(--ui-muted, #7b8971); letter-spacing: 1px; margin: 30px 8px 15px; }
	nav button { width: 100%; display: flex; gap: 9px; background: transparent; border: 0; padding: 13px 10px; text-align: left; color: var(--ui-muted, #6d7a60); border-radius: 5px; margin-bottom: 5px; }
	nav button span { overflow-wrap: anywhere; }
	nav button.chosen { background: var(--ui-active, #dce7ce); color: var(--ui-text, #35502d); }
	.new-project { margin-top: 13px; }
	.sidebar-footer { margin-top: auto; padding-top: 45px; display: flex; flex-direction: column; gap: 15px; }
	.sidebar-footer small { font-size: 10px; color: var(--ui-muted, #7c8a6c); }
	.admin-settings { font-size: 12px; color: var(--ui-text, #536a45); }
	.workspace { flex: 1; min-width: 0; padding: 0 35px; display: flex; flex-direction: column; }
	header { height: 85px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--ui-border, #e1e5dc); font-size: 11px; color: var(--ui-muted, #839076); }
	.project-header { margin-bottom: 24px; }
	header strong { color: var(--ui-text, #526348); font-weight: 500; }
	.badge { font-size: 8px; letter-spacing: 1px; border: 1px solid var(--ui-border, #d8dfd0); padding: 8px; border-radius: 4px; }
	.page-heading { display: flex; gap: 20px; align-items: center; justify-content: space-between; padding: 33px 0; }
	h1 { font-family: Georgia, serif; font-size: clamp(28px, 3vw, 40px); font-weight: 400; letter-spacing: -1px; margin: 12px 0; overflow-wrap: anywhere; }
	h2 { font-family: Georgia, serif; font-size: 25px; font-weight: 400; }
	h3 { font-size: 13px; }
	p { color: var(--ui-muted, #7a886e); font-size: 12px; line-height: 1.8; }
	.page-heading p { margin: 0; }
	.primary, .secondary { border-radius: 5px; padding: 10px 13px; font-size: 11px; white-space: nowrap; }
	.primary { color: var(--ui-on-primary, #f3f8ec); background: var(--ui-primary, #304d36); border: 1px solid var(--ui-primary, #304d36); }
	.secondary { color: var(--ui-text, #536a45); background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #d3ddc8); }
	.panel { background: var(--ui-surface, #fcfdfb); border: 1px solid var(--ui-border, #dce2d4); border-radius: 9px; overflow: hidden; }
	.empty-state { padding: 45px; text-align: center; margin-bottom: 30px; }
	.empty-state .primary { margin: 12px; }
	.inline-form { padding: 20px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
	.inline-form label { font-size: 12px; }
	input, textarea { color: var(--ui-text, #34492c); font: inherit; font-size: 12px; background: white; border: 1px solid var(--ui-border, #d4dec8); border-radius: 5px; padding: 10px; min-width: 0; }
	.inline-form input { flex: 1; min-width: 150px; }
	.edition-bar { padding: 14px; border: 1px solid var(--ui-border, #dce2d4); background: var(--ui-soft, #eef3e6); border-radius: 8px; display: flex; gap: 14px; flex-wrap: wrap; justify-content: space-between; margin-bottom: 20px; }
	.selected-edition, .save-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	.selected-edition strong { font-size: 12px; color: var(--ui-text, #3d5b2e); overflow-wrap: anywhere; }
	.save-actions > span { color: var(--ui-muted, #78886b); font-size: 10px; }
	.project-tools { display: flex; justify-content: space-between; gap: 15px; margin-bottom: 15px; align-items: center; flex-wrap: wrap; }
	.view-tabs { display: flex; flex-wrap: wrap; gap: 3px; }
	.view-tabs button { border: 0; border-radius: 4px; color: var(--ui-muted, #7b8a6e); background: transparent; padding: 9px 11px; font-size: 11px; }
	.view-tabs button.active { color: var(--ui-text, #3f5f2e); background: var(--ui-active, #e3ecd6); }
	.editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px; }
	.editor-panel { min-width: 0; }
	.panel-toolbar { display: flex; align-items: center; justify-content: space-between; height: 58px; padding: 14px 18px; border-bottom: 1px solid var(--ui-border, #e1e8d8); }
	.panel-toolbar h2 { font: 600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; }
	.panel-toolbar small { font-size: 10px; color: var(--ui-muted, #899779); }
	.template-form, .member-form { padding: 20px; }
	.template-form label, .member-form label { display: block; font-size: 11px; font-weight: 600; color: var(--ui-text, #5e7450); margin: 12px 0 8px; }
	.template-form input, .template-form textarea, .member-form input { width: 100%; }
	.template-form textarea { resize: vertical; font-family: monospace; line-height: 1.7; }
	.template-form p, .member-form p { font-size: 10px; }
	.template-form .save-actions { margin-top: 22px; }
	.member-form { border-top: 1px solid var(--ui-border, #e1e8d8); }
	.member-form button { margin-top: 14px; }
	.notice { padding: 12px 15px; border-radius: 5px; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
	.error { background: #fff0e8; color: #9b4335; }
	.success { background: var(--ui-soft, #edf4e3); color: var(--ui-text, #648249); }
	.library { padding: 25px; }
	.utm-form { max-width: 640px; }
	.utm-form input { width: 100%; }
	.utm-form .save-actions { margin-top: 22px; }
	.library label { display: block; font-size: 11px; margin: 16px 0 8px; color: var(--ui-text, #5e7450); }
	.upload-results { padding-left: 20px; color: var(--ui-text, #648249); font-size: 12px; line-height: 1.8; }
	.upload-results li { overflow-wrap: anywhere; }
	.upload-results .upload-failed { color: #9b4335; }
	.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-top: 25px; }
	.asset-grid article { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--ui-border, #dae3cf); border-radius: 7px; min-width: 0; }
	.asset-grid img { width: 100%; height: 130px; object-fit: contain; background: var(--ui-soft, #eff3e8); }
	.asset-grid strong { font-size: 11px; overflow-wrap: anywhere; }
	.asset-grid small { font-size: 10px; color: var(--ui-muted, #839574); }
	.asset-grid a { font-size: 11px; color: var(--ui-text, #537a37); }
	.delete-image { color: #9b4335; }
	.edition-export { padding: 14px; border: 1px solid var(--ui-border, #dce2d4); border-radius: 8px; margin-bottom: 20px; background: var(--ui-surface, #fcfdfb); }
	.edition-export label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 8px; }
	.edition-export p { margin-bottom: 0; }
	.export-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.export-actions input { flex: 1; min-width: min(100%, 240px); }
	.export-actions a { text-decoration: none; }
	.import-edition { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 25px 0; padding: 14px; background: var(--ui-soft, #eff3e8); border-radius: 7px; font-size: 11px; color: var(--ui-muted, #708363); }
	.import-edition input { max-width: 100%; }
	footer { font-size: 9px; letter-spacing: 1px; color: var(--ui-muted, #94a186); border-top: 1px solid var(--ui-border, #e1e5dc); padding: 20px 0; margin-top: auto; }
	.setup { min-height: 100vh; max-width: 780px; margin: auto; padding: 60px 25px; }
	.setup-card { padding: 35px; }
	.setup-card ol { font-size: 12px; color: var(--ui-muted, #6d7f5c); line-height: 2.2; padding-left: 20px; }
	@media (max-width: 1100px) { aside { width: 210px; padding: 28px 15px; } .workspace { padding: 0 22px; } .editor-grid { grid-template-columns: minmax(0, 1fr); } .page-heading { flex-wrap: wrap; } }
	@media (max-width: 640px) { .app { flex-direction: column; } aside { width: 100%; border-right: 0; border-bottom: 1px solid #dce1d6; padding: 20px; } .brand { margin-bottom: 20px; } .sidebar-footer { padding-top: 20px; } .workspace { padding: 0 18px; } header { height: 65px; } .badge { font-size: 7px; } nav { display: flex; flex-wrap: wrap; } nav button { width: auto; } .project-heading { margin-top: 20px; } .library { padding: 18px; } .setup-card { padding: 23px; } .inline-form input { width: 100%; } }
</style>
