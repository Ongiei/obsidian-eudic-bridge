import {App, TFolder} from 'obsidian';
import {LexiBridgeSettings} from './settings';
import {getLemma} from './lemmatizer';
import {getMarkdownEditSegments} from './utils/auto-link';
import {getMarkdownFilesRecursively} from './utils/vault-files';

const WORD_PATTERN = /\b[a-zA-Z]+(?:[-'][a-zA-Z]+)*\b/g;

export interface AutoLinkOccurrence {
	start: number;
	end: number;
	text: string;
	target: string;
	replacement: string;
}

export interface AutoLinkCandidate {
	target: string;
	count: number;
	examples: string[];
}

export interface AutoLinkPlan {
	content: string;
	occurrences: AutoLinkOccurrence[];
	candidates: AutoLinkCandidate[];
}

export type AutoLinkCleanupPlan = AutoLinkPlan;

export interface AutoLinkRange {
	from: number;
	to: number;
}

export class AutoLinkService {
	private localWordCache: Map<string, string> | null = null;

	constructor(private app: App, private settings: LexiBridgeSettings) {}

	invalidateCache(): void {
		this.localWordCache = null;
	}

	buildLocalWordCache(): Map<string, string> {
		if (this.localWordCache) return this.localWordCache;
		const words = new Map<string, string>();
		const folder = this.app.vault.getAbstractFileByPath(this.settings.folderPath);
		if (folder instanceof TFolder) {
			for (const file of getMarkdownFilesRecursively(folder)) {
				const target = file.path.replace(/\.md$/i, '');
				words.set(file.basename.toLowerCase(), target);
				const rawFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as unknown;
				const frontmatter = rawFrontmatter && typeof rawFrontmatter === 'object'
					? rawFrontmatter as Record<string, unknown>
					: undefined;
				const canonicalWord = frontmatter?.word;
				if (typeof canonicalWord === 'string' && canonicalWord.trim()) {
					words.set(canonicalWord.toLowerCase(), target);
				}
				const aliases = frontmatter?.aliases;
				if (Array.isArray(aliases)) {
					for (const alias of aliases) {
						if (typeof alias === 'string' && alias.trim()) words.set(alias.toLowerCase(), target);
					}
				}
			}
		}
		this.localWordCache = words;
		return words;
	}

	createPlan(
		content: string,
		range: AutoLinkRange = {from: 0, to: content.length},
		sourcePath?: string
	): AutoLinkPlan {
		const localWords = this.buildLocalWordCache();
		const ignored = new Set(this.settings.autoLinkIgnoredWords);
		const linkedTargets = new Set<string>();
		const occurrences: AutoLinkOccurrence[] = [];
		for (const line of content.split('\n')) {
			for (const target of findWikiLinkTargets(line)) {
				const normalizedTarget = normalizeTarget(target);
				linkedTargets.add(normalizeTarget(localWords.get(normalizedTarget) || target));
			}
		}
		for (const segment of this.getEditableSegments(content)) {
			WORD_PATTERN.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = WORD_PATTERN.exec(segment.text)) !== null) {
				const text = match[0];
				const lower = text.toLowerCase();
				const start = segment.start + match.index;
				const end = start + text.length;
				if (start < range.from || end > range.to || text.length < this.settings.autoLinkMinWordLength || ignored.has(lower)) continue;
				const target = localWords.get(getLemma(lower)) || localWords.get(lower);
				if (!target) continue;
				const targetKey = normalizeTarget(target);
				if (this.settings.autoLinkFirstOnly && linkedTargets.has(targetKey)) continue;
				linkedTargets.add(targetKey);
				const basename = target.split('/').pop() || target;
				const linkTarget = this.getPreferredLinkTarget(target, sourcePath);
				occurrences.push({
					start, end, text, target,
					replacement: text === basename && linkTarget === basename
						? `[[${linkTarget}]]`
						: `[[${linkTarget}|${text}]]`,
				});
			}
		}

		const grouped = new Map<string, AutoLinkCandidate>();
		for (const occurrence of occurrences) {
			const candidate = grouped.get(occurrence.target) || {target: occurrence.target, count: 0, examples: []};
			candidate.count += 1;
			if (!candidate.examples.includes(occurrence.text) && candidate.examples.length < 3) candidate.examples.push(occurrence.text);
			grouped.set(occurrence.target, candidate);
		}
		return {content, occurrences, candidates: [...grouped.values()].sort((a, b) => a.target.localeCompare(b.target))};
	}

	applyPlan(plan: AutoLinkPlan, selectedTargets: Set<string>): string {
		let result = plan.content;
		for (const occurrence of [...plan.occurrences].reverse()) {
			if (!selectedTargets.has(occurrence.target)) continue;
			result = result.slice(0, occurrence.start) + occurrence.replacement + result.slice(occurrence.end);
		}
		return result;
	}

	createCleanupPlan(content: string): AutoLinkCleanupPlan {
		const canonicalTargets = new Map<string, string>();
		for (const target of new Set(this.buildLocalWordCache().values())) {
			canonicalTargets.set(normalizeTarget(target), target);
			canonicalTargets.set(normalizeTarget(target.split('/').pop() || target), target);
		}
		const occurrences: AutoLinkOccurrence[] = [];
		const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
		for (const segment of this.getEditableSegments(content, true)) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(segment.text)) !== null) {
				const rawTarget = match[1];
				if (!rawTarget) continue;
				const target = canonicalTargets.get(normalizeTarget(rawTarget));
				if (!target) continue;
				const basename = target.split('/').pop() || target;
				const display = match[2] || basename;
				occurrences.push({
					start: segment.start + match.index,
					end: segment.start + match.index + match[0].length,
					text: display,
					target,
					replacement: display,
				});
			}
		}
		const grouped = new Map<string, AutoLinkCandidate>();
		for (const occurrence of occurrences) {
			const candidate = grouped.get(occurrence.target) || {target: occurrence.target, count: 0, examples: []};
			candidate.count += 1;
			if (!candidate.examples.includes(occurrence.text) && candidate.examples.length < 3) candidate.examples.push(occurrence.text);
			grouped.set(occurrence.target, candidate);
		}
		return {content, occurrences, candidates: [...grouped.values()].sort((a, b) => a.target.localeCompare(b.target))};
	}

	findMissingCandidates(content: string): AutoLinkCandidate[] {
		const localWords = this.buildLocalWordCache();
		const ignored = new Set(this.settings.autoLinkIgnoredWords);
		const candidates = new Map<string, AutoLinkCandidate>();
		for (const segment of this.getEditableSegments(content)) {
			WORD_PATTERN.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = WORD_PATTERN.exec(segment.text)) !== null) {
				const display = match[0];
				const word = display.toLowerCase();
				if (display.length < this.settings.autoLinkMinWordLength || ignored.has(word)
					|| localWords.has(word) || localWords.has(getLemma(word))) continue;
				const candidate = candidates.get(word) || {target: word, count: 0, examples: []};
				candidate.count += 1;
				if (!candidate.examples.includes(display) && candidate.examples.length < 3) candidate.examples.push(display);
				candidates.set(word, candidate);
			}
		}
		return [...candidates.values()].sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));
	}

	findLocalWord(word: string): string | null {
		const localWords = this.buildLocalWordCache();
		const lowerWord = word.toLowerCase();
		return localWords.get(getLemma(lowerWord)) || localWords.get(lowerWord) || null;
	}

	private getPreferredLinkTarget(target: string, sourcePath?: string): string {
		const basename = target.split('/').pop() || target;
		if (!sourcePath) return basename;

		const resolved = this.app.metadataCache.getFirstLinkpathDest(basename, sourcePath);
		if (!resolved || normalizeTarget(resolved.path) === normalizeTarget(target)) return basename;
		return target;
	}

	private getEditableSegments(content: string, includeWikiLinks = false) {
		return getMarkdownEditSegments(content, {
			excludedHeadings: this.settings.autoLinkExcludedHeadings,
			skipHeadings: this.settings.autoLinkSkipHeadings,
			skipBlockquotes: this.settings.autoLinkSkipBlockquotes,
			includeWikiLinks,
		});
	}
}

function findWikiLinkTargets(text: string): string[] {
	const targets: string[] = [];
	const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		const target = match[1];
		if (target) targets.push(target);
	}
	return targets;
}

function normalizeTarget(target: string): string {
	return target.replace(/\.md$/i, '').toLowerCase();
}
