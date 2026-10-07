export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'] as const;
export type UtmSettings = Record<(typeof UTM_KEYS)[number], string>;
export const EMPTY_UTM: UtmSettings = { utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '' };

export function parseUtm(value: unknown): UtmSettings {
	if (value === undefined) return { ...EMPTY_UTM };
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send UTM settings as an object.');
	const result = { ...EMPTY_UTM };
	for (const [key, entry] of Object.entries(value)) {
		if (!UTM_KEYS.some((allowed) => allowed === key)) throw new Error(`Unsupported UTM setting: ${key}.`);
		if (typeof entry !== 'string' || entry.length > 200 || /[\u0000-\u001f\u007f]/.test(entry)) {
			throw new Error('UTM values must be text up to 200 characters without control characters.');
		}
		for (const allowed of UTM_KEYS) if (allowed === key) result[allowed] = entry.trim();
	}
	return result;
}
