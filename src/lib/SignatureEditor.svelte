<script lang="ts">
	import { untrack } from 'svelte';
	import { jsonRequest, requestJson } from './api-client';
	import { readSource } from './files';
	import { contactFields, MAX_CONTACT_VALUE_LENGTH, renderSignature, signatureDownloadName, type SignatureContact, type SignatureDetail, type SignatureVariation } from './signatures';
	import { useToasts } from './toast-context';
	import WorkspaceTabs from './WorkspaceTabs.svelte';
	import TabIcon from './TabIcon.svelte';

	let { initial, canDelete, onDirtyChange, onSaved, onDeleted }: {
		initial: SignatureDetail;
		canDelete: boolean;
		onDirtyChange: (dirty: boolean) => void;
		onSaved: () => Promise<void>;
		onDeleted: () => Promise<void>;
	} = $props();
	const toasts = useToasts();
	const tabs = [
		{ id: 'variations', label: 'HTML variations', icon: 'templates' },
		{ id: 'contacts', label: 'Contacts', icon: 'contacts' },
		{ id: 'export', label: 'Preview & export', icon: 'publish' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	] as const;
	let signature = $state(untrack(() => initial));
	let name = $state(untrack(() => initial.name));
	let tab = $state<'variations' | 'contacts' | 'export' | 'settings'>('variations');
	let busy = $state(false);
	let variationId = $state<string | null>(null);
	let variationName = $state('');
	let variationFilename = $state('');
	let variationHtml = $state('');
	let variationSnapshot = $state('');
	let contactId = $state<string | null>(null);
	let contactDraft = $state<Record<string, string>>({});
	let contactSnapshot = $state('{}');
	let contactEditing = $state(false);
	let previewVariationId = $state('');
	let previewContactId = $state('');
	let selectedContacts = $state<string[]>(untrack(() => initial.contacts.map((contact) => contact.id)));
	let allVariations = $state(false);
	let deleteConfirmation = $state('');
	let uploadStatus = $state('');
	const fields = $derived([...new Set([...contactFields(signature.variations), ...Object.keys(contactDraft)])]);
	const contactDirty = $derived(contactEditing && contactState(contactDraft) !== contactSnapshot);
	const variationDirty = $derived(Boolean(variationId) && JSON.stringify([variationName, variationFilename, variationHtml]) !== variationSnapshot);
	const dirty = $derived(name !== signature.name || contactDirty || variationDirty);
	const previewVariation = $derived(signature.variations.find((variation) => variation.id === previewVariationId) ?? signature.variations[0]);
	const previewContact = $derived(signature.contacts.find((contact) => contact.id === previewContactId) ?? signature.contacts[0]);
	const exportVariations = $derived(allVariations ? signature.variations : previewVariation ? [previewVariation] : []);
	const exportContacts = $derived(signature.contacts.filter((contact) => selectedContacts.includes(contact.id)));
	const preview = $derived(previewVariation && previewContact ? rendered(previewVariation, previewContact) : null);
	const previewDocument = $derived(preview?.html ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${preview.html}` : '');
	const base = $derived(`/api/signatures/${signature.id}`);

	$effect(() => { onDirtyChange(dirty || busy); });

	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : 'The signature operation failed. Please try again.';
	}

	function contactState(values: Record<string, string>) {
		return JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
	}

	function rendered(variation: SignatureVariation, contact: SignatureContact): { html: string; error: string } {
		try { return { html: renderSignature(variation.html, contact.fields), error: '' }; }
		catch (cause) { return { html: '', error: message(cause) }; }
	}

	async function persist(path: string, method: string, body: Record<string, unknown>) {
		const result = await requestJson<{ signature: SignatureDetail }>(path, jsonRequest(method, { ...body, revision: signature.revision }));
		signature = result.signature;
		return result.signature;
	}

	async function notifySaved(success: string) {
		toasts.success(success);
		await onSaved();
	}

	function editVariation(variation: SignatureVariation) {
		if (variationDirty && !window.confirm('Discard unsaved variation changes?')) return;
		variationId = variation.id;
		variationName = variation.name;
		variationFilename = variation.filename;
		variationHtml = variation.html;
		variationSnapshot = JSON.stringify([variationName, variationFilename, variationHtml]);
	}

	function cancelVariation() {
		if (variationDirty && !window.confirm('Discard unsaved variation changes?')) return;
		variationId = null;
	}

	async function replaceVariation(input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) return;
		busy = true;
		try {
			if (!/\.html$/i.test(file.name)) throw new Error('Choose a .html file.');
			const source = await readSource(file);
			variationFilename = file.name;
			variationHtml = source;
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; input.value = ''; }
	}

	async function uploadVariations(input: HTMLInputElement) {
		const files = Array.from(input.files ?? []);
		if (!files.length || busy) return;
		busy = true;
		const results: string[] = [];
		let uploaded = 0;
		try {
			for (const [index, file] of files.entries()) {
				uploadStatus = `Uploading ${index + 1} of ${files.length}: ${file.name}`;
				try {
					if (!/\.html$/i.test(file.name)) throw new Error('Choose a .html file.');
					await persist(`${base}/variations`, 'POST', { name: file.name.replace(/\.html$/i, ''), filename: file.name, html: await readSource(file) });
					uploaded++;
					results.push(`${file.name}: uploaded`);
				} catch (cause) {
					const failure = `${file.name}: ${message(cause)}`;
					results.push(failure);
					toasts.error(failure);
				}
			}
			uploadStatus = results.join('\n');
			if (uploaded) await notifySaved(`${uploaded} of ${files.length} variations uploaded.`);
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; input.value = ''; }
	}

	async function saveVariation(event: SubmitEvent) {
		event.preventDefault();
		if (!variationId || busy) return;
		busy = true;
		try {
			await persist(`${base}/variations/${variationId}`, 'PATCH', { name: variationName, filename: variationFilename, html: variationHtml });
			variationId = null;
			await notifySaved('Variation saved. It uses the same contacts as every other variation.');
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; }
	}

	function editContact(contact?: SignatureContact) {
		if (contactDirty && !window.confirm('Discard unsaved contact changes?')) return;
		contactId = contact?.id ?? null;
		contactDraft = Object.fromEntries([...new Set([...contactFields(signature.variations), ...Object.keys(contact?.fields ?? {})])].map((field) => [field, contact?.fields[field] ?? '']));
		contactSnapshot = contactState(contact?.fields ?? contactDraft);
		contactEditing = true;
	}

	function cancelContact() {
		if (contactDirty && !window.confirm('Discard unsaved contact changes?')) return;
		contactEditing = false;
	}

	async function saveContact(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		try {
			const previousIds = new Set(signature.contacts.map((contact) => contact.id));
			const saved = await persist(`${base}/contacts${contactId ? `/${contactId}` : ''}`, contactId ? 'PATCH' : 'POST', {
				fields: Object.fromEntries(fields.map((field) => [field, contactDraft[field] ?? '']))
			});
			selectedContacts = [...new Set([...selectedContacts, ...saved.contacts.filter((contact) => !previousIds.has(contact.id)).map((contact) => contact.id)])];
			contactEditing = false;
			await notifySaved('Contact saved for all variations in this signature.');
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; }
	}

	async function remove(kind: 'contacts' | 'variations', id: string, label: string) {
		if (busy || !window.confirm(`Delete ${label}? ${kind === 'contacts' ? 'This contact will be removed from every variation in this signature.' : 'The contacts and other variations will be kept.'} This cannot be undone.`)) return;
		if ((kind === 'contacts' && id === contactId && contactDirty) || (kind === 'variations' && id === variationId && variationDirty)) {
			if (!window.confirm('This also discards unsaved changes to this entry. Continue?')) return;
		}
		busy = true;
		try {
			await persist(`${base}/${kind}/${id}`, 'DELETE', {});
			if (kind === 'contacts') {
				selectedContacts = selectedContacts.filter((value) => value !== id);
				if (contactId === id) contactEditing = false;
			} else if (variationId === id) variationId = null;
			await notifySaved(kind === 'contacts' ? 'Contact deleted.' : 'Variation deleted.');
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; }
	}

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		try {
			await persist(base, 'PATCH', { name });
			name = signature.name;
			await notifySaved('Signature name saved.');
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; }
	}

	async function deleteSignature(event: SubmitEvent) {
		event.preventDefault();
		if (!canDelete) { toasts.error('Only administrators can delete signatures.'); return; }
		if (busy || !window.confirm(`Permanently delete "${signature.name}", all its HTML variations, and all its contacts?`)) return;
		busy = true;
		try {
			await requestJson(base, jsonRequest('DELETE', { revision: signature.revision, confirmName: deleteConfirmation }));
			name = signature.name;
			contactEditing = false;
			variationId = null;
			busy = false;
			onDirtyChange(false);
			await onDeleted();
			toasts.success('Signature deleted.');
		} catch (cause) { toasts.error(message(cause)); }
		finally { busy = false; }
	}

	async function copyHtml() {
		if (!preview?.html) return;
		try { await navigator.clipboard.writeText(preview.html); toasts.success('Personalized HTML copied.'); }
		catch (cause) { toasts.error(`HTML could not be copied. Download the HTML instead. ${message(cause)}`); }
	}
</script>

<div class="project-tools">
	<WorkspaceTabs label="Signature views">
		{#each tabs as item (item.id)}
			<button class:active={tab === item.id} disabled={busy} onclick={() => tab = item.id}><TabIcon name={item.icon} />{item.label}</button>
		{/each}
	</WorkspaceTabs>
</div>

<fieldset disabled={busy}>
	{#if tab === 'variations'}
		<section class="panel library">
			<h2>HTML variations ({signature.variations.length})</h2>
			<p>Upload separate .html files, up to 1 MB each. Use simple placeholders such as <code>{'{{ name }}'}</code> and <code>{'{{ phone }}'}</code>. Contact fields are shared across all variations in this signature. Quote attribute values, for example <code>{'href="tel:{{ phone }}"'}</code>. Scripts and active HTML are not supported.</p>
			<p>Use <code>{'{{#if phone}}Phone: {{phone}}{{else}}No phone listed{{/if}}'}</code> for optional content. Nested conditions and <code>{'{{else if email}}'}</code> are supported. Empty or missing fields choose the else branch.</p>
			<label for="signature-upload">Upload HTML variations</label><input id="signature-upload" type="file" accept=".html,text/html" multiple onchange={(event) => uploadVariations(event.currentTarget)} />
			{#if uploadStatus}<p class="upload-status" role="status">{uploadStatus}</p>{/if}
			<ul class="entry-list">
				{#each signature.variations as variation (variation.id)}
					<li><div><strong>{variation.name}</strong><small>{variation.filename}</small></div><div class="actions"><button class="secondary" onclick={() => editVariation(variation)}>Edit variation</button><button class="destructive" onclick={() => remove('variations', variation.id, `variation "${variation.name}"`)}>Delete variation</button></div></li>
				{/each}
			</ul>
			{#if !signature.variations.length}<p>No variations yet. Upload your first HTML file above.</p>{/if}
			{#if variationId}
				<form class="entry-form" onsubmit={saveVariation}>
					<h3>Edit variation</h3>
					<label for="variation-name">Variation name</label><input id="variation-name" bind:value={variationName} maxlength="160" required />
					<label for="variation-replacement">Replace HTML file</label><input id="variation-replacement" type="file" accept=".html,text/html" onchange={(event) => replaceVariation(event.currentTarget)} />
					<label for="variation-html">HTML source ({variationFilename})</label><textarea id="variation-html" bind:value={variationHtml} rows="12" spellcheck="false" required></textarea>
					<div class="actions"><button class="primary" disabled={!variationDirty || !variationName.trim() || !variationHtml.trim()}>Save variation</button><button class="secondary" type="button" onclick={cancelVariation}>Cancel</button></div>
				</form>
			{/if}
		</section>
	{:else if tab === 'contacts'}
		<section class="panel library">
			<div class="section-heading"><h2>Contacts ({signature.contacts.length})</h2><button class="primary" onclick={() => editContact()}>+ New contact</button></div>
			<p>These contacts belong only to this signature and apply to every variation. Fields are generated from all uploaded placeholders. Name is always required; other fields can be left blank.</p>
			<ul class="entry-list">
				{#each signature.contacts as contact (contact.id)}
					<li><div><strong>{contact.fields.name}</strong><small>{contact.fields.phone ?? contact.fields.email ?? ''}</small></div><div class="actions"><button class="secondary" onclick={() => editContact(contact)}>Edit contact</button><button class="destructive" onclick={() => remove('contacts', contact.id, `contact "${contact.fields.name}"`)}>Delete contact</button></div></li>
				{/each}
			</ul>
			{#if !signature.contacts.length}<p>No contacts yet. Add a contact to personalize your signature variations.</p>{/if}
			{#if contactEditing}
				<form class="entry-form" onsubmit={saveContact}>
					<h3>{contactId ? 'Edit contact' : 'New contact'}</h3>
					<div class="contact-fields">{#each fields as field (field)}<div><label for={`contact-${field}`}>{field.replace(/[_-]/g, ' ')}</label><input id={`contact-${field}`} bind:value={contactDraft[field]} maxlength={field === 'name' ? 160 : MAX_CONTACT_VALUE_LENGTH} required={field === 'name'} /></div>{/each}</div>
					<div class="actions"><button class="primary" disabled={!contactDraft.name?.trim() || (Boolean(contactId) && !contactDirty)}>Save contact</button><button class="secondary" type="button" onclick={cancelContact}>Cancel</button></div>
				</form>
			{/if}
		</section>
	{:else if tab === 'export'}
		<section class="panel library">
			<h2>Preview &amp; export</h2>
			<p>Previews and downloads use saved variations and saved contact information. Select one or more contacts to generate a separate HTML file for each contact and variation.</p>
			{#if !signature.variations.length || !signature.contacts.length}<p>Upload at least one HTML variation and add a contact first.</p>
			{:else}
				<div class="selectors">
					<div><label for="preview-variation">Preview variation</label><select id="preview-variation" value={previewVariation?.id} onchange={(event) => previewVariationId = event.currentTarget.value}>{#each signature.variations as variation (variation.id)}<option value={variation.id}>{variation.name}</option>{/each}</select></div>
					<div><label for="preview-contact">Preview contact</label><select id="preview-contact" value={previewContact?.id} onchange={(event) => previewContactId = event.currentTarget.value}>{#each signature.contacts as contact (contact.id)}<option value={contact.id}>{contact.fields.name}</option>{/each}</select></div>
				</div>
				{#if preview?.error}<p class="error" role="alert">{preview.error}</p>
				{:else if previewDocument}<iframe title="Personalized email signature preview" sandbox="" referrerpolicy="no-referrer" srcdoc={previewDocument}></iframe><button class="secondary" onclick={copyHtml}>Copy HTML</button>{/if}
				<h3>Download personalized signatures</h3>
				<label class="checkbox"><input type="checkbox" bind:checked={allVariations} /> Export all variations</label>
				<div class="actions"><button class="secondary" onclick={() => selectedContacts = signature.contacts.map((contact) => contact.id)}>Select all contacts</button><button class="secondary" onclick={() => selectedContacts = []}>Clear selection</button></div>
				<div class="contact-selection">{#each signature.contacts as contact (contact.id)}<label class="checkbox"><input type="checkbox" bind:group={selectedContacts} value={contact.id} /> {contact.fields.name}</label>{/each}</div>
				{#if !exportContacts.length}<p>Select at least one contact.</p>{/if}
				<ul class="entry-list">
					{#each exportContacts as contact (contact.id)}
						{#each exportVariations as variation (variation.id)}
							{@const output = rendered(variation, contact)}
							<li><div><strong>{contact.fields.name} — {variation.name}</strong>{#if output.error}<small class="error" role="alert">{output.error}</small>{/if}</div>{#if !output.error}<a class="secondary" href={`${base}/render?variationId=${variation.id}&contactId=${contact.id}`} download={signatureDownloadName(signature.name, variation.name, contact.fields.name)}>Download HTML</a>{/if}</li>
						{/each}
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="panel library">
			<h2>Signature settings</h2>
			<p>All signed-in users can view and edit this signature, its variations, and its contacts. Deleting a user account does not delete workspace content.</p>
			<form onsubmit={saveName}><label for="edit-signature-name">Signature name</label><input id="edit-signature-name" bind:value={name} maxlength="160" required /><button class="primary" disabled={name === signature.name || !name.trim()}>Save signature name</button></form>
			{#if canDelete}<form class="danger-zone" onsubmit={deleteSignature}>
				<h3>Delete signature</h3><p>This permanently deletes this signature, every uploaded variation, and all its contacts. Newsletters and other signatures are kept.</p>
				<label for="delete-signature-confirmation">Type <strong>{signature.name}</strong> to confirm</label><input id="delete-signature-confirmation" bind:value={deleteConfirmation} autocomplete="off" required />
				<button class="destructive" disabled={deleteConfirmation !== signature.name}>Delete signature</button>
			</form>{:else}<p>Only administrators can delete signatures.</p>{/if}
		</section>
	{/if}
</fieldset>

<style>
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	.actions, .section-heading { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	.section-heading { justify-content: space-between; margin-bottom: 15px; }
	.section-heading h2 { margin: 0; }
	h3 { margin: 24px 0 12px; }
	small { font-size: 12px; line-height: 1.8; color: var(--ui-muted, #78886b); overflow-wrap: anywhere; }
	input:not([type='checkbox']), select, textarea { width: 100%; }
	textarea { resize: vertical; font-family: monospace; line-height: 1.7; }
	form > button, form > .actions { margin-top: 16px; }
	.entry-list { list-style: none; padding: 0; margin: 20px 0; }
	.entry-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 0; border-bottom: 1px solid var(--ui-border, #dce1d6); }
	.entry-list strong { font-size: 12px; overflow-wrap: anywhere; }
	.entry-list small { display: block; }
	.entry-form, .danger-zone { border-top: 1px solid var(--ui-border, #dce1d6); padding-top: 12px; margin-top: 24px; }
	.danger-zone h3, .error { color: #9b4335; }
	.contact-fields, .selectors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
	iframe { box-sizing: border-box; width: 100%; height: 300px; border: 1px solid var(--ui-border, #dce1d6); border-radius: 6px; background: white; margin: 20px 0 12px; }
	.library label.checkbox { display: flex; gap: 8px; align-items: center; font-weight: 400; }
	.checkbox input { padding: 0; }
	.contact-selection { display: flex; flex-wrap: wrap; gap: 0 24px; }
	.upload-status { white-space: pre-wrap; }
	@media (max-width: 640px) { .contact-fields, .selectors { grid-template-columns: 1fr; } }
</style>
