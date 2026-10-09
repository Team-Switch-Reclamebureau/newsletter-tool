import { error, json } from '@sveltejs/kit';
import { newsletterHtmlUrl } from '#lib/remote.js';
import { parseTestRecipients } from '#lib/test-recipients.js';
import { readEmailSettings, sendNewsletterTest } from '#lib/server/email.js';
import { api, rateLimit, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { renderSavedNewsletter, type SavedNewsletterSource } from '#lib/server/saved-newsletter.js';
import { requireProject } from '#lib/server/workspace.js';

export const POST = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const projectId = uuid(event.params.projectId);
	const newsletterId = uuid(event.params.newsletterId);
	await requireProject(pool, projectId, user.id);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => key !== 'recipientsRevision')) error(400, 'Test emails use the saved campaign and project recipient list; do not send draft content or recipients.');
	const expectedRecipients = revision(body.recipientsRevision);
	const result = await pool.query<SavedNewsletterSource & { recipients: string[]; recipients_revision: number; public_id: string }>(`
		SELECT n.content, n.public_id, p.template, p.item_template,
			COALESCE(r.recipients, '{}'::text[]) AS recipients, COALESCE(r.revision, 1) AS recipients_revision
		FROM newsletters n JOIN projects p ON p.id = n.project_id
		LEFT JOIN project_test_recipients r ON r.project_id = p.id
		WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`, [newsletterId, projectId]);
	const row = result.rows[0];
	if (!row) error(404, 'Save this campaign before sending a test email.');
	if (row.recipients_revision !== expectedRecipients) error(409, 'Test recipients changed elsewhere. Reload the project before sending to the updated list.');
	let recipients: string[];
	try { recipients = parseTestRecipients(row.recipients.join(', ')); }
	catch (cause) { error(422, cause instanceof Error ? cause.message : 'Update the saved project test recipients.'); }
	if (!recipients.length) error(400, 'Add and save at least one project test recipient first.');
	const settings = await readEmailSettings(pool);
	if (!settings.host || !settings.fromEmail) error(503, 'Ask an administrator to configure SMTP in Admin settings before sending a newsletter test.');
	await rateLimit(pool, `newsletter-test-user:${user.id}`, 5);
	await rateLimit(pool, `newsletter-test-project:${projectId}`, 5);
	const rendered = await renderSavedNewsletter(row, newsletterId);
	let delivery;
	try {
		delivery = await sendNewsletterTest(pool, config.authSecret, recipients, `[Test] ${rendered.newsletter.name}`,
			`Test email for "${rendered.newsletter.name}".\n\nView the latest saved campaign:\n${newsletterHtmlUrl(config.origin, row.public_id)}`, rendered.html);
	} catch (cause) {
		console.error('Newsletter test SMTP setup failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'The test email could not be sent. Check the saved SMTP settings and server logs.');
	}
	if (!delivery.accepted.length) error(503, 'The SMTP server did not confirm any test deliveries. Check SMTP settings and logs before retrying.');
	const message = delivery.failed.length
		? `Test accepted for ${delivery.accepted.join(', ')} but not confirmed for ${delivery.failed.join(', ')}. Check SMTP logs before retrying; some recipients may already have received it.`
		: `Test email for "${rendered.newsletter.name}" accepted by SMTP for ${delivery.accepted.length} ${delivery.accepted.length === 1 ? 'recipient' : 'recipients'}.`;
	return json({ ...delivery, message }, { status: delivery.failed.length ? 207 : 200 });
});
