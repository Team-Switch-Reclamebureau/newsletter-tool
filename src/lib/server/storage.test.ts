import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES } from '../remote';
import { LocalImageStorage, processImage } from './storage';

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('image processing', () => {
	it('normalizes a real PNG to WebP with exact dimensions', async () => {
		const source = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#31502b' } }).png().toBuffer();
		const result = await processImage(source, 'image/png');
		expect(result.width).toBe(48);
		expect(result.height).toBe(32);
		const metadata = await sharp(result.data).metadata();
		expect(metadata.format).toBe('webp');
		expect(metadata.exif).toBeUndefined();
	});

	it('rejects empty, oversized, corrupt, and disguised SVG files', async () => {
		await expect(processImage(new Uint8Array(), 'image/png')).rejects.toThrow('5 MB');
		await expect(processImage(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png')).rejects.toThrow('5 MB');
		await expect(processImage(new TextEncoder().encode('not an image'), 'image/png')).rejects.toThrow('decoded');
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
		await expect(processImage(svg, 'image/png')).rejects.toThrow('static');
		await expect(processImage(svg, 'image/svg+xml')).rejects.toThrow('JPEG');
	});

	it('rejects images beyond the 20 megapixel decode limit', async () => {
		const source = await sharp({ create: { width: 4001, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
		await expect(processImage(source, 'image/png')).rejects.toThrow('20 megapixel');
	});
});

describe('immutable local image storage', () => {
	it('writes atomically and refuses to replace an existing asset', async () => {
		const root = await mkdtemp(join(tmpdir(), 'postroom-storage-test-'));
		directories.push(root);
		const storage = new LocalImageStorage(root);
		const id = randomUUID();
		const first = new Uint8Array([1, 2, 3]);
		await storage.put(id, first);
		await expect(storage.put(id, new Uint8Array([4]))).rejects.toThrow();
		expect([...await storage.read(id)]).toEqual([...first]);
		expect(await readdir(join(root, '.staging'))).toEqual([]);
		await storage.removeUncommitted(id);
		await expect(storage.read(id)).rejects.toThrow();
	});

	it('rejects path traversal before touching the filesystem', async () => {
		const storage = new LocalImageStorage('/unused');
		await expect(storage.read('../escape')).rejects.toThrow('Invalid asset');
		await expect(storage.removePermanent('../escape')).rejects.toThrow('Invalid asset');
	});

	it('permanently removes files and allows deletion retries', async () => {
		const root = await mkdtemp(join(tmpdir(), 'postroom-storage-delete-test-'));
		directories.push(root);
		const storage = new LocalImageStorage(root);
		const id = randomUUID();
		await storage.put(id, new Uint8Array([1, 2, 3]));
		await storage.removePermanent(id);
		await expect(storage.read(id)).rejects.toThrow();
		await expect(storage.removePermanent(id)).resolves.toBeUndefined();
	});
});
