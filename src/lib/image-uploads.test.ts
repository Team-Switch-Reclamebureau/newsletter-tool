import { describe, expect, it } from 'vitest';
import { uploadImages, type ImageUploadResult } from './image-uploads';
import type { ImageAsset } from './remote';

function image(filename: string): ImageAsset {
	return {
		scope: 'project',
		id: crypto.randomUUID(), projectId: crypto.randomUUID(), filename,
		url: `https://example.test/${filename}.webp`, width: 16, height: 16,
		bytes: 100, createdAt: new Date().toISOString()
	};
}

describe('multiple image uploads', () => {
	it('uploads every selected file in order, with at most one upload in flight', async () => {
		const files = ['first.png', 'second.jpg', 'third.webp'].map((name) => new File(['image'], name));
		let active = 0;
		let maximum = 0;
		const progress: ImageUploadResult[] = [];
		const results = await uploadImages(files, async (file) => {
			active++;
			maximum = Math.max(maximum, active);
			await Promise.resolve();
			active--;
			return image(file.name);
		}, (result) => progress.push(result));
		expect(maximum).toBe(1);
		expect(results.map((result) => result.filename)).toEqual(files.map((file) => file.name));
		expect(results.every((result) => result.status === 'uploaded')).toBe(true);
		expect(progress).toEqual(results);
	});

	it('reports each failure and continues to upload subsequent files', async () => {
		const files = ['first.png', 'broken.png', 'last.png'].map((name) => new File(['image'], name));
		const attempted: string[] = [];
		const progress: ImageUploadResult[] = [];
		const first = image('first.png');
		const last = image('last.png');
		const results = await uploadImages(files, async (file) => {
			attempted.push(file.name);
			if (file.name === 'broken.png') throw new Error('The image could not be decoded.');
			return file.name === 'first.png' ? first : last;
		}, (result) => progress.push(result));
		expect(attempted).toEqual(['first.png', 'broken.png', 'last.png']);
		expect(results).toEqual([
			{ filename: 'first.png', status: 'uploaded', asset: first },
			{ filename: 'broken.png', status: 'failed', error: 'The image could not be decoded.' },
			{ filename: 'last.png', status: 'uploaded', asset: last }
		]);
		expect(progress).toEqual(results);
	});

	it('retains separate results for duplicate filenames and reports non-Error rejections', async () => {
		const files = [new File(['first'], 'photo.png'), new File(['second'], 'photo.png')];
		const results = await uploadImages(files, async () => { throw 'Upload failed'; }, () => {});
		expect(results).toHaveLength(2);
		expect(results.every((result) => result.status === 'failed'
			&& result.error === 'The image could not be uploaded.')).toBe(true);
	});

	it('does not treat a progress callback failure as a file failure', async () => {
		await expect(uploadImages([new File(['image'], 'photo.png')], async () => image('photo.png'), () => {
			throw new Error('Progress could not be updated.');
		})).rejects.toThrow('Progress could not be updated.');
	});
});
