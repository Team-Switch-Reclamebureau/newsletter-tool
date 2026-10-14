import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { contactFields, MAX_CONTACT_VALUE_LENGTH, MAX_SIGNATURE_FIELDS, renderSignature, validateSignatureTemplate, type EmailSignature, type SignatureContact, type SignatureDetail, type SignatureVariation } from '../signatures';
import { object, revision } from './http';
import { transaction } from './workspace';

type Database = Pool | PoolClient;

export function signatureName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || value.includes('\0')) error(400, 'Names must contain 1-160 characters without null characters.');
	return value.trim();
}

export async function listSignatures(database: Database): Promise<EmailSignature[]> {
	return (await database.query<EmailSignature>('SELECT id, name, revision FROM email_signatures ORDER BY lower(name), id')).rows;
}

export async function requireSignature(database: Database, id: string, userId: string, lock = false): Promise<EmailSignature> {
	if (lock && !(await database.query('SELECT id FROM "user" WHERE id = $1 FOR KEY SHARE', [userId])).rowCount) error(401, 'Sign in to access this workspace.');
	const result = await database.query<EmailSignature>(`SELECT id, name, revision FROM email_signatures WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
	if (!result.rows[0]) error(404, 'Signature not found.');
	return result.rows[0];
}

export async function signatureDetail(database: Database, signature: EmailSignature): Promise<SignatureDetail> {
	const [variations, contacts] = await Promise.all([
		database.query<SignatureVariation>('SELECT id, name, filename, html FROM signature_variations WHERE signature_id = $1 ORDER BY lower(name), id', [signature.id]),
		database.query<SignatureContact>("SELECT id, fields FROM signature_contacts WHERE signature_id = $1 ORDER BY lower(fields->>'name'), id", [signature.id])
	]);
	return { ...signature, variations: variations.rows, contacts: contacts.rows };
}

export async function mutateSignature(pool: Pool, id: string, userId: string, savedRevision: unknown, mutate: (client: PoolClient, signature: EmailSignature) => Promise<void>): Promise<SignatureDetail> {
	const expected = revision(savedRevision);
	return transaction(pool, async (client) => {
		const signature = await requireSignature(client, id, userId, true);
		if (signature.revision !== expected) error(409, 'This signature changed since you loaded it. Reload before saving.');
		await mutate(client, signature);
		const updated = await client.query<EmailSignature>('UPDATE email_signatures SET revision = revision + 1 WHERE id = $1 RETURNING id, name, revision', [id]);
		return signatureDetail(client, updated.rows[0]);
	});
}

export function variationInput(body: Record<string, unknown>) {
	const name = signatureName(body.name);
	if (typeof body.filename !== 'string' || !/^[^/\\\u0000-\u001f]{1,200}\.html$/i.test(body.filename)) error(400, 'Upload a file with a .html extension and a filename no longer than 205 characters.');
	if (typeof body.html !== 'string') error(400, 'An HTML file is required.');
	try { validateSignatureTemplate(body.html); }
	catch (cause) { error(400, cause instanceof Error ? cause.message : 'Invalid signature HTML.'); }
	return { name, filename: body.filename, html: body.html };
}

export async function saveVariation(client: PoolClient, signatureId: string, body: Record<string, unknown>, id?: string) {
	const input = variationInput(body);
	const duplicate = await client.query('SELECT id FROM signature_variations WHERE signature_id = $1 AND name = $2 AND ($3::uuid IS NULL OR id <> $3)', [signatureId, input.name, id ?? null]);
	if (duplicate.rowCount) error(400, 'A variation with this name already exists in this signature.');
	if (id) {
		const result = await client.query('UPDATE signature_variations SET name = $3, filename = $4, html = $5 WHERE signature_id = $1 AND id = $2', [signatureId, id, input.name, input.filename, input.html]);
		if (!result.rowCount) error(404, 'Variation not found in this signature.');
	} else {
		await client.query('INSERT INTO signature_variations(id, signature_id, name, filename, html) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), signatureId, input.name, input.filename, input.html]);
	}
	const templates = (await client.query<Pick<SignatureVariation, 'html'>>('SELECT html FROM signature_variations WHERE signature_id = $1', [signatureId])).rows;
	if (contactFields(templates).length > MAX_SIGNATURE_FIELDS) error(400, `A signature may contain no more than ${MAX_SIGNATURE_FIELDS} different contact fields across its variations.`);
}

export function contactInput(body: Record<string, unknown>): Record<string, string> {
	const input = object(body.fields);
	const entries = Object.entries(input);
	if (entries.length > MAX_SIGNATURE_FIELDS) error(400, `Use no more than ${MAX_SIGNATURE_FIELDS} contact fields.`);
	const fields: Record<string, string> = {};
	for (const [key, value] of entries) {
		if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
			|| typeof value !== 'string' || value.length > MAX_CONTACT_VALUE_LENGTH || value.includes('\0')) error(400, `Contact fields must have simple names and text values of at most ${MAX_CONTACT_VALUE_LENGTH} characters, without null characters.`);
		fields[key] = value.trim();
	}
	fields.name = signatureName(input.name);
	return fields;
}

export async function saveContact(client: PoolClient, signatureId: string, body: Record<string, unknown>, id?: string) {
	const fields = contactInput(body);
	if (id) {
		const result = await client.query('UPDATE signature_contacts SET fields = $3 WHERE signature_id = $1 AND id = $2', [signatureId, id, JSON.stringify(fields)]);
		if (!result.rowCount) error(404, 'Contact not found in this signature.');
	} else {
		await client.query('INSERT INTO signature_contacts(id, signature_id, fields) VALUES ($1, $2, $3)', [randomUUID(), signatureId, JSON.stringify(fields)]);
	}
}

export async function renderSavedSignature(database: Database, signatureId: string, variationId: string, contactId: string) {
	const variations = await database.query<SignatureVariation>('SELECT id, name, filename, html FROM signature_variations WHERE signature_id = $1 AND id = $2', [signatureId, variationId]);
	const contacts = await database.query<SignatureContact>('SELECT id, fields FROM signature_contacts WHERE signature_id = $1 AND id = $2', [signatureId, contactId]);
	const variation = variations.rows[0], contact = contacts.rows[0];
	if (!variation || !contact) error(404, 'Variation or contact not found in this signature.');
	try { return { html: renderSignature(variation.html, contact.fields), variation, contact }; }
	catch (cause) { error(400, cause instanceof Error ? cause.message : 'The signature could not be rendered.'); }
}
