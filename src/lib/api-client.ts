import type { RenderResult } from './server/render';
import type { UtmSettings } from './utm';

export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
	const response = await fetch(path, options);
	if (!response.headers.get('content-type')?.includes('application/json')) {
		throw new Error(`The server returned an unexpected response (${response.status}). Please try again.`);
	}
	const body: T & { message?: string } = await response.json();
	if (!response.ok) throw new Error(body.message || `The request failed (${response.status}).`);
	return body;
}

export function jsonRequest(method: string, value: unknown): RequestInit {
	return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

export function renderMjml(source: string, signal?: AbortSignal, utm?: UtmSettings) {
	return requestJson<RenderResult>('/api/render', { ...jsonRequest('POST', { source, utm }), signal });
}
