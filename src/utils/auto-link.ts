export interface MarkdownTextPart {
	text: string;
	isProtected: boolean;
}

export interface MarkdownEditSegment {
	text: string;
	start: number;
}

export interface MarkdownProtectionOptions {
	excludedHeadings: string[];
	skipHeadings: boolean;
	skipBlockquotes: boolean;
	includeWikiLinks?: boolean;
}

const PROTECTED_MARKDOWN_PATTERN = /(`+[^`\n]*`+|!?\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^\n)]*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|<[^>\n]+>|(?:https?:\/\/|mailto:|www\.)[^\s<>()]+|#[a-zA-Z0-9_/-]+)/g;

export function splitProtectedMarkdown(text: string): MarkdownTextPart[] {
	const parts: MarkdownTextPart[] = [];
	let match: RegExpExecArray | null;
	let lastEnd = 0;

	PROTECTED_MARKDOWN_PATTERN.lastIndex = 0;
	while ((match = PROTECTED_MARKDOWN_PATTERN.exec(text)) !== null) {
		if (match.index > lastEnd) {
			parts.push({ text: text.slice(lastEnd, match.index), isProtected: false });
		}
		parts.push({ text: match[0], isProtected: true });
		lastEnd = match.index + match[0].length;
	}

	if (lastEnd < text.length) {
		parts.push({ text: text.slice(lastEnd), isProtected: false });
	}

	return parts.length > 0 ? parts : [{ text, isProtected: false }];
}

export function getFenceMarker(line: string): { character: '`' | '~'; length: number } | null {
	const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
	const marker = match?.[1];
	if (!marker) return null;
	return {
		character: marker[0] as '`' | '~',
		length: marker.length,
	};
}

export function isReferenceDefinition(line: string): boolean {
	return /^\s{0,3}\[[^\]]+\]:/.test(line);
}

export function getMarkdownEditSegments(
	content: string,
	options: MarkdownProtectionOptions
): MarkdownEditSegment[] {
	const segments: MarkdownEditSegment[] = [];
	const frontmatterEnd = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0;
	const excludedHeadings = new Set(options.excludedHeadings.map(title => title.trim().toLowerCase()).filter(Boolean));
	let excludedHeadingLevel: number | null = null;
	let activeFence: {character: '`' | '~'; length: number} | null = null;
	let inHtmlComment = false;
	let lineStart = 0;

	for (const line of content.split('\n')) {
		const fence = getFenceMarker(line);
		const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (heading?.[1] && heading[2]) {
			const level = heading[1].length;
			if (excludedHeadingLevel !== null && level <= excludedHeadingLevel) excludedHeadingLevel = null;
			if (excludedHeadings.has(heading[2].trim().toLowerCase())) excludedHeadingLevel = level;
		}
		const wasInFence = activeFence !== null;
		if (fence && !activeFence) activeFence = fence;
		else if (activeFence && fence
			&& fence.character === activeFence.character
			&& fence.length >= activeFence.length) {
			activeFence = null;
		}

		const skipLine = lineStart < frontmatterEnd
			|| wasInFence || Boolean(fence)
			|| excludedHeadingLevel !== null
			|| /^(?:\t| {4})/.test(line)
			|| isReferenceDefinition(line)
			|| (options.skipHeadings && /^\s{0,3}#{1,6}\s/.test(line))
			|| (options.skipBlockquotes && /^\s{0,3}>/.test(line));
		if (!skipLine) {
			for (const commentPart of splitHtmlCommentParts(line, inHtmlComment)) {
				inHtmlComment = commentPart.endsInsideComment;
				if (commentPart.isProtected) continue;
				let partOffset = 0;
				for (const part of splitProtectedMarkdown(commentPart.text)) {
					const editableWikiLink = options.includeWikiLinks && /^\[\[/.test(part.text);
					if ((!part.isProtected || editableWikiLink) && part.text) {
						segments.push({
							text: part.text,
							start: lineStart + commentPart.start + partOffset,
						});
					}
					partOffset += part.text.length;
				}
			}
		} else {
			inHtmlComment = updateHtmlCommentState(line, inHtmlComment);
		}
		lineStart += line.length + 1;
	}
	return segments;
}

interface HtmlCommentPart {
	text: string;
	start: number;
	isProtected: boolean;
	endsInsideComment: boolean;
}

function splitHtmlCommentParts(line: string, startsInsideComment: boolean): HtmlCommentPart[] {
	const parts: HtmlCommentPart[] = [];
	let cursor = 0;
	let inside = startsInsideComment;
	while (cursor < line.length) {
		if (inside) {
			const end = line.indexOf('-->', cursor);
			const next = end < 0 ? line.length : end + 3;
			parts.push({text: line.slice(cursor, next), start: cursor, isProtected: true, endsInsideComment: end < 0});
			cursor = next;
			inside = end < 0;
			continue;
		}
		const start = line.indexOf('<!--', cursor);
		const next = start < 0 ? line.length : start;
		if (next > cursor) {
			parts.push({text: line.slice(cursor, next), start: cursor, isProtected: false, endsInsideComment: false});
		}
		if (start < 0) break;
		cursor = start;
		inside = true;
	}
	return parts;
}

function updateHtmlCommentState(line: string, startsInsideComment: boolean): boolean {
	const parts = splitHtmlCommentParts(line, startsInsideComment);
	return parts.length > 0 ? parts[parts.length - 1]!.endsInsideComment : startsInsideComment;
}
