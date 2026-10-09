<script lang="ts">
	import AccountPanel from '#lib/AccountPanel.svelte';
	import PasswordForm from '#lib/PasswordForm.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AccountPanel title="Change password" applicationName={data.settings.applicationName}>
	<p>{data.email}</p>
	<PasswordForm mode="change" />
	<p><a href="/">Back to workspace</a></p>
</AccountPanel>
