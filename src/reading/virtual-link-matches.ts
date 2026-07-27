export interface VirtualLinkWordMatch {
	word: string;
	index: number;
}

const WORD_PATTERN = /[a-zA-Z]+(?:[-'][a-zA-Z]+)*/g;
const EXCLUDED_SYNTAX = /code|link|url|frontmatter|html|comment|tag|escape/i;

export function findVirtualLinkWordMatches(text: string): VirtualLinkWordMatch[] {
	const matches: VirtualLinkWordMatch[] = [];
	let match: RegExpExecArray | null;
	WORD_PATTERN.lastIndex = 0;
	while ((match = WORD_PATTERN.exec(text)) !== null) {
		const word = match[0];
		if (!hasWordBoundaries(text, match.index, match.index + word.length)) continue;
		matches.push({word, index: match.index});
	}
	return matches;
}

export function isExcludedVirtualLinkSyntax(nodeName: string): boolean {
	return EXCLUDED_SYNTAX.test(nodeName);
}

function hasWordBoundaries(text: string, start: number, end: number): boolean {
	return !isJoinedToWord(text, start - 1, -1) && !isJoinedToWord(text, end, 1);
}

function isJoinedToWord(text: string, index: number, direction: -1 | 1): boolean {
	const adjacent = text[index];
	if (!adjacent) return false;
	if (/[a-zA-Z0-9]/.test(adjacent)) return true;
	if (adjacent !== '_') return false;

	let cursor = index;
	while (text[cursor] === '_') cursor += direction;
	const outsideUnderscores = text[cursor];
	return Boolean(outsideUnderscores && /[a-zA-Z0-9]/.test(outsideUnderscores));
}
