export interface ApplicationSettings {
	applicationName: string;
	baseColor: string;
	accentColor: string;
	revision: number;
}

export const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
	applicationName: 'Postroom',
	baseColor: '#425f30',
	accentColor: '#425f30',
	revision: 1
};

export function brandingError(applicationName: unknown, baseColor: unknown, accentColor: unknown): string | null {
	if (typeof applicationName !== 'string' || !applicationName.trim() || applicationName.trim().length > 80
		|| /[\u0000-\u001f\u007f]/.test(applicationName)) {
		return 'Enter an application name between 1 and 80 characters without control characters.';
	}
	for (const [label, color] of [['base', baseColor], ['accent', accentColor]]) {
		if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
			return `Choose a ${label} color in six-digit hexadecimal format, such as #425f30.`;
		}
	}
	return null;
}

export function interfaceTheme(baseColor: string, accentColor: string): string {
	if (![baseColor, accentColor].every((color) => /^#[0-9a-f]{6}$/i.test(color))) throw new Error('Invalid interface color.');
	baseColor = baseColor.toLowerCase();
	accentColor = accentColor.toLowerCase();
	const channels = [1, 3, 5].map((offset) => {
		const channel = parseInt(accentColor.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	const accent = [
		`--ui-primary:${accentColor}`,
		`--ui-on-primary:${luminance > 0.179 ? '#000000' : '#ffffff'}`,
		`--ui-accent:${accentColor}`
	];
	const mix = (percentage: number, base = 'white') => `color-mix(in srgb, ${baseColor} ${percentage}%, ${base})`;
	return [
		...accent,
		'--ui-text:#20252b',
		'--ui-muted:#616975',
		'--ui-bg:#f7f8fa',
		'--ui-surface:#ffffff',
		'--ui-soft:#f1f3f5',
		'--ui-border:#e2e5e9',
		'--ui-canvas:#f7f8fa',
		`--ui-base:${baseColor}`,
		`--ui-base-ink:${mix(35, '#20252b')}`,
		`--ui-sidebar:${mix(6, '#f4f5f7')}`,
		`--ui-active:${mix(12, '#f4f5f7')}`,
		'--ui-shadow:0 1px 2px rgb(16 24 40 / 3%), 0 4px 16px rgb(16 24 40 / 3%)'
	].join(';');
}
