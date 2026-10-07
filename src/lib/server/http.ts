import { error, isHttpError, isRedirect, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { MAX_TEMPLATE_BYTES, UUID_PATTERN } from '../remote';
import { getRuntime } from './runtime';
import type { Pool } from 'pg';

export function requireUser(event: RequestEvent) {
	const runtime = getRuntime();
	if (!runtime) error(503, 'Configure the hosted workspace first.');
	if (!event.locals.user) error(401, 'Sign in to access this workspace.');
	if (!['GET', 'HEAD'].includes(event.request.method)
		&& event.request.headers.get('origin') !== runtime.config.origin) {
		error(403, 'This request must come from the configured application origin.');
	}

	return { ...runtime, user: event.locals.user };
}

export function requireAdmin(event: RequestEvent) {
	const runtime = requireUser(event);
	if (!runtime.user.isAdmin) error(403, 'Administrator access is required.');
	return runtime;
}

export function uuid(value: string | undefined): string {
	if (!value || !UUID_PATTERN.test(value)) error(400, 'A valid id is required.');
	return value;
}

export function object(value: unknown): Record<string, unknown> {
	if (!isObject(value)) error(400, 'Send a JSON object.');
	return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function revision(value: unknown): number {
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) error(400, 'A valid saved revision is required.');
	return value;
}

export async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
	const reader = request.body?.getReader();
	if (!reader) error(400, 'A request body is required.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			error(413, 'The request is too large.');
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
	return body;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Send application/json.');
	const body = await readBody(request, MAX_TEMPLATE_BYTES * 12 + 2048);
	let value: unknown;
	try { value = JSON.parse(new TextDecoder().decode(body)); }
	catch { error(400, 'Send valid JSON.'); }
	return object(value);
}

export function api(handler: RequestHandler): RequestHandler {
	return async (event) => {
		try { return await handler(event); }
		catch (cause) {
			if (isHttpError(cause) || isRedirect(cause)) throw cause;
			console.error(`Request failed: ${event.request.method} ${event.url.pathname}`, cause);
			error(500, 'The operation failed. Please try again; contact your administrator if it persists.');
		}
	};
}

export async function rateLimit(pool: Pool, key: string, max: number) {
	const result = await pool.query<{ attempts: number }>(`
		INSERT INTO api_rate_limits(key, window_start, attempts) VALUES ($1, now(), 1)
		ON CONFLICT (key) DO UPDATE SET
		  attempts = CASE WHEN api_rate_limits.window_start < now() - interval '1 minute' THEN 1 ELSE api_rate_limits.attempts + 1 END,
		  window_start = CASE WHEN api_rate_limits.window_start < now() - interval '1 minute' THEN now() ELSE api_rate_limits.window_start END
		RETURNING attempts`, [key]);
	if (result.rows[0].attempts > max) error(429, 'Too many requests. Please wait a minute and try again.');
}
