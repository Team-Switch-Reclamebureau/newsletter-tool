import { describe, expect, it, vi } from 'vitest';
import { readSource } from './files';
import { MAX_TEMPLATE_BYTES } from './remote';
import { createNewsletter, parseNewsletter, serializeNewsletter } from './newsletters';

describe('import file loading', () => {
	it('preserves the original content', async () => {
		expect(await readSource(new File(['line 1\n\tline 2'], 'template.mjml'))).toBe('line 1\n\tline 2');
	});

	it('imports newsletter data without requiring the filename to match its id', async () => {
		const newsletter = createNewsletter('October edition');
		const file = new File([serializeNewsletter(newsletter)], 'October edition.json');
		expect(parseNewsletter(await readSource(file))).toEqual(newsletter);
	});

	it('rejects files larger than 1 MB', async () => {
		await expect(readSource(new File(['x'.repeat(MAX_TEMPLATE_BYTES + 1)], 'template.mjml'))).rejects.toThrow('too large');
	});

	it('enforces the byte limit for multibyte content', async () => {
		await expect(readSource(new File(['é'.repeat(MAX_TEMPLATE_BYTES)], 'template.mjml'))).rejects.toThrow('too large');
	});

	it('accepts files exactly at the byte limit', async () => {
		const contents = 'x'.repeat(MAX_TEMPLATE_BYTES);
		expect(await readSource(new File([contents], 'template.mjml'))).toBe(contents);
	});

	it('surfaces read errors', async () => {
		const file = new File(['content'], 'template.mjml');
		vi.spyOn(file, 'text').mockRejectedValueOnce(new Error('Read failed'));
		await expect(readSource(file)).rejects.toThrow('Read failed');
	});
});
