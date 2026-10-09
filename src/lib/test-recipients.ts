import { validEmail } from './email-settings';

export const MAX_TEST_RECIPIENTS = 20;
export const MAX_TEST_RECIPIENTS_LENGTH = MAX_TEST_RECIPIENTS * 256;

export interface TestRecipientsSettings {
	recipients: string[];
	revision: number;
}

export interface TestEmailResult {
	accepted: string[];
	failed: string[];
	message: string;
}

export function parseTestRecipients(value: unknown): string[] {
	if (typeof value !== 'string' || value.length > MAX_TEST_RECIPIENTS_LENGTH) {
		throw new Error(`Enter up to ${MAX_TEST_RECIPIENTS} comma-separated email addresses.`);
	}
	if (!value.trim()) return [];
	const recipients = value.split(',').map((address) => address.trim().toLowerCase());
	if (recipients.some((address) => !validEmail(address) || /[;:"\\()[\]]/.test(address))) {
		throw new Error('Enter plain email addresses separated by commas, without display names or empty entries.');
	}
	const unique = [...new Set(recipients)];
	if (unique.length > MAX_TEST_RECIPIENTS) throw new Error(`A test email can have at most ${MAX_TEST_RECIPIENTS} recipients.`);
	return unique;
}
