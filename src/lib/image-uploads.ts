import type { ImageAsset } from './remote';

export type ImageUploadResult =
	| { filename: string; status: 'uploaded'; asset: ImageAsset }
	| { filename: string; status: 'failed'; error: string };

export async function uploadImages(
	files: readonly File[],
	upload: (file: File) => Promise<ImageAsset>,
	onResult: (result: ImageUploadResult) => void
): Promise<ImageUploadResult[]> {
	const results: ImageUploadResult[] = [];
	for (const file of files) {
		let result: ImageUploadResult;
		try {
			result = { filename: file.name, status: 'uploaded', asset: await upload(file) };
		} catch (cause) {
			result = {
				filename: file.name, status: 'failed',
				error: cause instanceof Error ? cause.message : 'The image could not be uploaded.'
			};
		}
		results.push(result);
		onResult(result);
	}
	return results;
}
