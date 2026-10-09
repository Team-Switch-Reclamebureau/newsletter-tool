import { describe, expect, it } from 'vitest';
import { decryptSmtpPassword, encryptSmtpPassword } from './email';
import { emailSettingsError, validEmail } from '../email-settings';

describe('SMTP credentials', () => {
	it('encrypts and authenticates passwords with randomized ciphertext', () => {
		const secret = 'a'.repeat(32);
		const password = 'smtp password with punctuation & spaces';
		const encrypted = encryptSmtpPassword(password, secret);
		expect(encrypted).not.toContain(password);
		expect(encryptSmtpPassword(password, secret)).not.toBe(encrypted);
		expect(decryptSmtpPassword(encrypted, secret)).toBe(password);
		expect(() => decryptSmtpPassword(encrypted, 'b'.repeat(32))).toThrow();
		const [iv, tag, ciphertext] = encrypted.split('.');
		expect(() => decryptSmtpPassword(`${iv}.${tag}.${ciphertext.slice(4)}`, secret)).toThrow();
		expect(() => decryptSmtpPassword('invalid', secret)).toThrow();
		expect(encryptSmtpPassword('', secret)).toBe('');
		expect(decryptSmtpPassword('', secret)).toBe('');
	});
});

describe('email settings validation', () => {
	const settings = { host: 'smtp.example.test', port: 587, security: 'starttls', username: 'sender', password: '', clearPassword: false, fromEmail: 'sender@example.test', fromName: 'Postroom' };
	it('accepts all supported connection modes', () => {
		for (const security of ['starttls', 'tls', 'none']) expect(emailSettingsError({ ...settings, security })).toBeNull();
	});
	it('rejects invalid ports, headers, addresses, and ambiguous password changes', () => {
		for (const patch of [
			{ host: '' }, { host: 'smtp://example.test' }, { host: 'smtp.test\r\ninjection' },
			{ port: 0 }, { port: 65536 }, { port: 1.5 }, { port: '587' }, { security: 'invalid' },
			{ fromEmail: 'Display <sender@example.test>' }, { fromEmail: 'a@example.test\r\nBcc:x@example.test' },
			{ username: 'user\nx' }, { fromName: 'name\rx' }, { password: 'x'.repeat(4097) },
			{ password: 'new', clearPassword: true }
		]) expect(emailSettingsError({ ...settings, ...patch })).not.toBeNull();
		expect(validEmail('hello+world@example.test')).toBe(true);
		expect(validEmail(null)).toBe(false);
	});
});
