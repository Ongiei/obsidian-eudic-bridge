const DEFAULT_INLINE_LIMIT = 4000;
const DEFAULT_URL_LIMIT = 2048;

export interface ExternalUrlPolicy {
	allowObsidian?: boolean;
	allowHttpHosts?: string[];
}

export function normalizeUntrustedText(value: string, maxLength = DEFAULT_INLINE_LIMIT): string {
	const characters: string[] = [];
	const scanLimit = Math.max(maxLength + 1024, maxLength * 4);
	for (const character of value) {
		if (characters.length >= scanLimit) break;
		const code = character.charCodeAt(0);
		if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
			characters.push(character);
		}
	}
	const withoutControls = characters.join('');
	const normalized = withoutControls
		.replace(/\r\n?/g, '\n')
		.replace(/\s*\n+\s*/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function sanitizeMarkdownInline(value: string, maxLength = DEFAULT_INLINE_LIMIT): string {
	return normalizeUntrustedText(value, maxLength)
		.replace(/\\/g, '\\\\')
		.replace(/([`*_[\]<>])/g, '\\$1');
}

export function sanitizeExternalUrl(value: string, policy: ExternalUrlPolicy = {}): string | null {
	const candidate = normalizeUntrustedText(value, DEFAULT_URL_LIMIT);
	if (!candidate || /\s/.test(candidate)) return null;
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol === 'https:') return parsed.toString();
		if (parsed.protocol === 'obsidian:' && policy.allowObsidian) return parsed.toString();
		if (parsed.protocol !== 'http:') return null;
		const hostname = parsed.hostname.toLowerCase();
		const allowedHosts = new Set((policy.allowHttpHosts ?? []).map(host => host.toLowerCase()));
		return allowedHosts.has(hostname) ? parsed.toString() : null;
	} catch {
		return null;
	}
}

export function sanitizeMarkdownUrl(value: string, policy: ExternalUrlPolicy = {}): string | null {
	const safe = sanitizeExternalUrl(value, policy);
	return safe ? safe.replace(/[()\\]/g, character => `\\${character}`) : null;
}
