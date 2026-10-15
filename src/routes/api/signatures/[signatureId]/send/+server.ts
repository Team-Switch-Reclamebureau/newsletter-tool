import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { validEmail } from '#lib/email-settings.js';
import { renderSignature, signatureInstructionEmail, type SignatureEmailResult } from '#lib/signatures.js';
import { richTextPlainText } from '#lib/rich-text.js';
import { readEmailSettings, sendPersonalizedEmails } from '#lib/server/email.js';
import { api, rateLimit, readJson, requireUser, revision, uuid } from '#lib/server/http.js';
import { requireSignature, signatureDetail } from '#lib/server/signatures.js';
import { transaction } from '#lib/server/workspace.js';

export const POST = api(async (event) => {
	const { pool, user, config } = requireUser(event);
	const signatureId = uuid(event.params.signatureId);
	const body = await readJson(event.request);
	if (Object.keys(body).some((key) => !['revision', 'variationId', 'contactIds'].includes(key))) error(400, 'Send only a saved revision, variation, and contact selection.');
	const expected = revision(body.revision);
	const variationId = uuid(typeof body.variationId === 'string' ? body.variationId : undefined);
	if (!Array.isArray(body.contactIds) || !body.contactIds.length) error(400, 'Select at least one contact.');
	const contactIds = [...new Set(body.contactIds.map((id: unknown) => uuid(typeof id === 'string' ? id : undefined)))];
	await requireSignature(pool, signatureId, user.id);
	const settings = await readEmailSettings(pool);
	if (!settings.host || !settings.fromEmail) error(503, 'Ask an administrator to configure SMTP in Admin settings before sending signatures.');
	await rateLimit(pool, `signature-send-user:${user.id}`, 5);
	await rateLimit(pool, `signature-send:${signatureId}`, 5);
	const messages = await transaction(pool, async (client) => {
		const saved = await requireSignature(client, signatureId, user.id, true);
		if (saved.revision !== expected) error(409, 'This signature changed since you loaded it. Reload before sending.');
		const signature = await signatureDetail(client, saved);
		const instructionText = richTextPlainText(signature.instructionText);
		if (!instructionText.trim()) error(400, 'Save instruction email text in Signature settings before sending.');
		const variation = signature.variations.find((entry) => entry.id === variationId);
		if (!variation) error(404, 'Variation not found in this signature.');
		const messages = [];
		for (const id of contactIds) {
			const contact = signature.contacts.find((entry) => entry.id === id);
			if (!contact) error(404, 'Contact not found in this signature.');
			if (!validEmail(contact.fields.email)) error(400, `Add a valid email address for "${contact.fields.name}" before sending.`);
			let html: string;
			try { html = renderSignature(variation.html, contact.fields); }
			catch (cause) { error(400, `${contact.fields.name}: ${cause instanceof Error ? cause.message : 'The signature could not be rendered.'}`); }
			const token = randomUUID();
			await client.query('INSERT INTO signature_downloads(id, signature_id, html) VALUES ($1, $2, $3)', [token, signatureId, html]);
			const downloadUrl = `${config.origin}/signature-downloads/${token}/signature.html`;
			messages.push({
				id, to: contact.fields.email, subject: `Your email signature - ${signature.name}`,
				...signatureInstructionEmail(signature.instructionText, signature.downloadLinkText, downloadUrl)
			});
		}
		return messages;
	});
	let delivery;
	try { delivery = await sendPersonalizedEmails(pool, config.authSecret, messages); }
	catch (cause) {
		console.error('Signature SMTP setup failed:', cause instanceof Error ? cause.message : 'Unknown delivery error');
		error(503, 'Signature emails could not be sent. Check SMTP settings and server logs before retrying.');
	}
	const result: SignatureEmailResult = {
		...delivery,
		message: delivery.failed.length
			? `SMTP accepted ${delivery.accepted.length} emails; ${delivery.failed.length} were not confirmed. Check delivery results and SMTP logs before retrying; some contacts may already have received an email.`
			: `SMTP accepted emails for all ${delivery.accepted.length} selected contacts.`
	};
	return json(result, { status: delivery.failed.length ? 207 : 200 });
});
