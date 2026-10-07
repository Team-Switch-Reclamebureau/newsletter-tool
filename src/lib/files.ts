import { MAX_TEMPLATE_BYTES } from './remote';

export async function readSource(file: File): Promise<string> {
	if (file.size > MAX_TEMPLATE_BYTES) {
		throw new Error(`${file.name} is too large. The limit is 1 MB per file.`);
	}
	return file.text();
}
