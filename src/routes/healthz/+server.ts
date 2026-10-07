import { json } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';

export async function GET() {
	const runtime = getRuntime();
	if (!runtime) return json({ status: 'not-configured' }, { status: 503 });
	try {
		await runtime.pool.query('SELECT 1');
		return json({ status: 'ok' });
	} catch (cause) {
		console.error('Database health check failed:', cause);
		return json({ status: 'unavailable' }, { status: 503 });
	}
}
