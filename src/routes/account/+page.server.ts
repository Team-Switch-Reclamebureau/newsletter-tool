import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/http.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (!event.locals.user) redirect(303, '/login');
	const { user } = requireUser(event);
	const verificationError = event.url.searchParams.get('error');
	return {
		name: user.name, email: user.email,
		emailChanged: event.url.searchParams.get('emailChanged') === '1' && !verificationError,
		verificationError: verificationError
			? 'The email verification link is invalid, expired, or no longer available. Request a new link below. If you are signed in to a different account, sign out and try the link again.'
			: ''
	};
};
