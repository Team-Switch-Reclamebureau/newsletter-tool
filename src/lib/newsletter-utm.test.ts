import { describe, expect, it } from 'vitest';
import { cloneNewsletter, createNewsletter, parseNewsletter, serializeNewsletter } from './newsletters';
import { EMPTY_UTM } from './utm';

describe('edition UTM persistence', () => {
	it('imports older edition JSON with blank UTM settings', () => {
		const newsletter = createNewsletter('Legacy edition');
		const legacy = JSON.stringify({ ...newsletter, utm: undefined });
		expect(parseNewsletter(legacy).utm).toEqual(EMPTY_UTM);
	});

	it('round-trips settings through edition JSON and clones them independently', () => {
		const newsletter = createNewsletter('Original edition');
		newsletter.utm = { utm_source: 'mail', utm_medium: 'mail', utm_campaign: 'nieuwsbrief', utm_term: 'october_26' };
		const imported = parseNewsletter(serializeNewsletter(newsletter));
		expect(imported.utm).toEqual(newsletter.utm);
		const clone = cloneNewsletter(imported, 'November edition');
		expect(clone.utm).toEqual(imported.utm);
		clone.utm.utm_term = 'november_26';
		expect(imported.utm.utm_term).toBe('october_26');
		expect(newsletter.utm.utm_term).toBe('october_26');
	});

	it('rejects invalid UTM settings in edition JSON', () => {
		const newsletter = createNewsletter('Invalid edition');
		for (const utm of [null, [], { utm_source: 1 }, { utm_term: 'x'.repeat(201) }]) {
			expect(() => parseNewsletter(JSON.stringify({ ...newsletter, utm }))).toThrow();
		}
	});
});
