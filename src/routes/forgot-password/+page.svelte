<script lang="ts">
	import AccountPanel from '#lib/AccountPanel.svelte';
	import PasswordForm from '#lib/PasswordForm.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AccountPanel title="Forgot your password?" applicationName={data.settings.applicationName}>
	<PasswordForm mode="recovery" />
</AccountPanel>
