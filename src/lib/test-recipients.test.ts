import { describe, expect, it } from 'vitest';
import { MAX_TEST_RECIPIENTS, MAX_TEST_RECIPIENTS_LENGTH, parseTestRecipients } from './test-recipients';

describe('project test recipients', () => {
	it('normalizes comma-separated addresses and removes duplicates', () => {
		expect(parseTestRecipients(' Alice@example.test, bob+news@example.test, ALICE@example.test ')).toEqual([
			'alice@example.test', 'bob+news@example.test'
		]);
	});

	it('allows clearing the shared list', () => {
		expect(parseTestRecipients('')).toEqual([]);
		expect(parseTestRecipients(' \n ')).toEqual([]);
	});

	it('accepts exactly twenty unique recipients and rejects twenty-one', () => {
		const addresses = Array.from({ length: MAX_TEST_RECIPIENTS }, (_, index) => `reader${index}@example.test`);
		expect(parseTestRecipients(addresses.join(', '))).toEqual(addresses);
		expect(() => parseTestRecipients([...addresses, 'extra@example.test'].join(', '))).toThrow('at most 20');
	});

	it('accepts the maximum input length and rejects larger input', () => {
		const addresses = Array.from({ length: 20 }, (_, index) => `${'x'.repeat(239)}${String(index).padStart(2, '0')}@example.test`);
		const input = ` ${addresses.join(', ')} `;
		expect(input).toHaveLength(MAX_TEST_RECIPIENTS_LENGTH);
		expect(parseTestRecipients(input)).toEqual(addresses);
		expect(() => parseTestRecipients(`${input} `)).toThrow('up to 20');
	});

	it('rejects malformed input, address lists, display names and header injection', () => {
		for (const input of [
			null, undefined, 1, [], {}, 'not-an-email', ',alice@example.test', 'alice@example.test,',
			'alice@example.test,,bob@example.test', 'Alice <alice@example.test>',
			'alice@example.test;bob@example.test', '"alice"@example.test',
			'alice@example.test\r\nBcc: hidden@example.test', 'a\\b@example.test', 'a(b)@example.test',
			'a@[127.0.0.1]', 'alice@example.test\u0000'
		]) expect(() => parseTestRecipients(input)).toThrow();
	});
});
