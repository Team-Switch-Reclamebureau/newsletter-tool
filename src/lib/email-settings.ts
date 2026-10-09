export interface EmailSettings {
	host: string;
	port: number;
	security: 'starttls' | 'tls' | 'none';
	username: string;
	fromEmail: string;
	fromName: string;
	passwordConfigured: boolean;
	revision: number;
}

export function validEmail(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 254 && /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/.test(value);
}

export function emailSettingsError(body: Record<string, unknown>): string | null {
	if (typeof body.host !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(body.host.trim())) return 'Enter a valid SMTP hostname or IPv4 address.';
	if (typeof body.port !== 'number' || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535) return 'Enter an SMTP port between 1 and 65535.';
	if (!['starttls', 'tls', 'none'].includes(String(body.security))) return 'Choose STARTTLS, TLS, or an unencrypted internal relay.';
	if (!validEmail(body.fromEmail)) return 'Enter a valid sender email address.';
	for (const key of ['username', 'fromName']) {
		if (typeof body[key] !== 'string' || body[key].length > 254 || /[\u0000-\u001f\u007f]/.test(body[key])) return 'Enter a valid SMTP username and sender name without control characters.';
	}
	if (typeof body.password !== 'string' || body.password.length > 4096) return 'Enter an SMTP password of at most 4096 characters.';
	if (typeof body.clearPassword !== 'boolean') return 'Specify whether to clear the saved SMTP password.';
	if (body.clearPassword && body.password) return 'Do not enter a new password when clearing the saved password.';
	return null;
}
