import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Pool } from 'pg';
import type { EmailSettings } from '../email-settings';

interface SmtpRow {
	host: string;
	port: number;
	security: EmailSettings['security'];
	username: string;
	password_encrypted: string;
	from_email: string;
	from_name: string;
	revision: number;
}

function encryptionKey(secret: string) {
	return createHash('sha256').update(`postroom-smtp:${secret}`).digest();
}

export function encryptSmtpPassword(password: string, secret: string): string {
	if (!password) return '';
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
	const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decryptSmtpPassword(encrypted: string, secret: string): string {
	if (!encrypted) return '';
	const parts = encrypted.split('.');
	if (parts.length !== 3) throw new Error('Invalid encrypted SMTP password.');
	const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
	const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function readSmtpRow(pool: Pool): Promise<SmtpRow> {
	const result = await pool.query<SmtpRow>('SELECT * FROM smtp_settings WHERE singleton = true');
	if (!result.rows[0]) throw new Error('Email settings are missing. Run database migrations.');
	return result.rows[0];
}

export async function readEmailSettings(pool: Pool): Promise<EmailSettings> {
	const row = await readSmtpRow(pool);
	return {
		host: row.host, port: row.port, security: row.security, username: row.username,
		fromEmail: row.from_email, fromName: row.from_name,
		passwordConfigured: Boolean(row.password_encrypted), revision: row.revision
	};
}

export async function sendEmail(pool: Pool, secret: string, to: string, subject: string, text: string) {
	const row = await readSmtpRow(pool);
	if (!row.host || !row.from_email) throw new Error('Configure SMTP in Admin settings before sending email.');
	const transport = nodemailer.createTransport({
		host: row.host, port: row.port, secure: row.security === 'tls',
		requireTLS: row.security === 'starttls', ignoreTLS: row.security === 'none',
		...(row.username ? { auth: { user: row.username, pass: decryptSmtpPassword(row.password_encrypted, secret) } } : {}),
		connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
		disableFileAccess: true, disableUrlAccess: true
	});
	try {
		const result = await transport.sendMail({
			from: { name: row.from_name, address: row.from_email }, to, subject, text
		});
		if (!result.accepted.length || result.rejected.length) throw new Error('The SMTP server rejected the recipient.');
	} finally { transport.close(); }
}
