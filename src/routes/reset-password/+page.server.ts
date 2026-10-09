import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const token = url.searchParams.get('token') ?? '';
	return { token: /^[a-zA-Z0-9_-]{1,256}$/.test(token) ? token : '', invitation: url.searchParams.get('invitation') === '1' };
};
