import { error, type Handle } from '@sveltejs/kit';
import { getRuntime } from '#lib/server/runtime.js';
import { PUBLIC_AUTH_PATHS } from '#lib/server/auth.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	const runtime = getRuntime();
	if (event.url.pathname.startsWith('/api/auth/') && event.url.pathname !== '/api/auth/request-password-reset') {
		if (!runtime) return new Response('Configure the hosted workspace first.', { status: 503 });
		const path = event.url.pathname.slice('/api/auth'.length);
		if (!PUBLIC_AUTH_PATHS.has(path)) return new Response('This authentication action is not available. Contact your administrator.', { status: 403 });
		const response = await runtime.auth.handler(event.request);
		response.headers.set('Cache-Control', 'no-store');
		response.headers.set('Referrer-Policy', 'no-referrer');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		return response;
	}
	if (runtime && event.request.headers.has('cookie') && !event.url.pathname.startsWith('/media/')) {
		try {
			const session = await runtime.auth.api.getSession({ headers: event.request.headers });
			if (session) {
				const admins = await runtime.pool.query<{ is_admin: boolean }>('SELECT EXISTS(SELECT 1 FROM application_admins WHERE user_id = $1) AS is_admin', [session.user.id]);
				event.locals.user = { id: session.user.id, email: session.user.email, name: session.user.name, isAdmin: admins.rows[0].is_admin };
			}
		} catch (cause) {
			console.error('Could not verify the session:', cause);
			error(503, 'The authentication service is unavailable. Please try again.');
		}
	}
	const response = await resolve(event);
	if (!event.url.pathname.startsWith('/media/') && !response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', event.url.pathname === '/reset-password' ? 'no-referrer' : 'strict-origin-when-cross-origin');
	return response;
};
