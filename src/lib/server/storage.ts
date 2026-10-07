import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES, UUID_PATTERN } from '../remote';

export class ImageValidationError extends Error {}

export interface ProcessedImage {
	data: Buffer;
	width: number;
	height: number;
}

export async function processImage(data: Uint8Array, declaredType: string): Promise<ProcessedImage> {
	if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new ImageValidationError('Images must be between 1 byte and 5 MB.');
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(declaredType)) {
		throw new ImageValidationError('Upload a JPEG, PNG, or WebP image.');
	}
	try {
		const image = sharp(data, { limitInputPixels: 20_000_000, failOn: 'error' });
		const metadata = await image.metadata();
		if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
			throw new ImageValidationError('Only static JPEG, PNG, and WebP images are supported.');
		}
		const result = await image.rotate().webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
		if (result.data.byteLength > MAX_IMAGE_BYTES) throw new ImageValidationError('The processed image exceeds 5 MB.');
		return { data: result.data, width: result.info.width, height: result.info.height };
	} catch (error) {
		if (error instanceof ImageValidationError) throw error;
		throw new ImageValidationError('The image could not be decoded, or exceeds the 20 megapixel limit.');
	}
}

export interface ImageStorage {
	put: (id: string, data: Uint8Array) => Promise<void>;
	read: (id: string) => Promise<Buffer>;
	removeUncommitted: (id: string) => Promise<void>;
	removePermanent: (id: string) => Promise<void>;
}

export class LocalImageStorage implements ImageStorage {
	constructor(private readonly root: string) {}

	private path(id: string) {
		if (!UUID_PATTERN.test(id)) throw new Error('Invalid asset id.');
		return join(this.root, `${id}.webp`);
	}

	async put(id: string, data: Uint8Array) {
		const destination = this.path(id);
		const staging = join(this.root, '.staging');
		await mkdir(staging, { recursive: true });
		const temporary = join(staging, `${randomUUID()}.tmp`);
		await writeFile(temporary, data, { flag: 'wx' });
		try {
			// Linking exposes a complete file atomically and refuses to overwrite an existing asset.
			await link(temporary, destination);
		} finally {
			await unlink(temporary);
		}
	}

	async read(id: string) {
		return readFile(this.path(id));
	}

	async removeUncommitted(id: string) {
		await unlink(this.path(id));
	}

	async removePermanent(id: string) {
		try { await unlink(this.path(id)); }
		catch (cause) {
			if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return;
			throw cause;
		}
	}
}
