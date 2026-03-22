import { App, Notice, TFile, TFolder } from 'obsidian';
import { LinkDictSettings } from './settings';
import { YoudaoService } from './youdao';
import { DictEntry } from './types';
import { t } from './i18n';

const EUDIC_SYNC_CALLOUT = '> [!info] Eudic Sync';

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeYamlString(str: string): string {
	if (!str) return str;
	if (str.includes(':') || str.includes("'") || str.includes('"') || str.includes('\n') || str.includes('#')) {
		return `'${str.replace(/'/g, "''")}'`;
	}
	return str;
}

export interface BatchUpdateResult {
	total: number;
	updated: number;
	skipped: number;
	failed: number;
}

export class BatchUpdateService {
	private app: App;
	private settings: LinkDictSettings;
	private isRunning: boolean = false;
	private shouldStop: boolean = false;

	constructor(app: App, settings: LinkDictSettings) {
		this.app = app;
		this.settings = settings;
	}

	stop(): void {
		this.shouldStop = true;
	}

	isInProgress(): boolean {
		return this.isRunning;
	}

	async batchUpdate(progressCallback?: (current: number, total: number, word: string) => void): Promise<BatchUpdateResult> {
		if (this.isRunning) {
			new Notice(t('notice_batchInProgress'));
			return { total: 0, updated: 0, skipped: 0, failed: 0 };
		}

		this.isRunning = true;
		this.shouldStop = false;

		const result: BatchUpdateResult = { total: 0, updated: 0, skipped: 0, failed: 0 };

		try {
			const filesNeedingUpdate = await this.findFilesNeedingUpdate();
			result.total = filesNeedingUpdate.length;

			if (filesNeedingUpdate.length === 0) {
				new Notice(t('notice_noFilesToUpdate'));
				return result;
			}

			new Notice(t('notice_batchStarted', { count: result.total }));

			const chunkSize = this.settings.batchChunkSize;
			const delayMs = this.settings.batchDelayMs;

			for (let i = 0; i < filesNeedingUpdate.length; i += chunkSize) {
				if (this.shouldStop) {
					new Notice(t('notice_batchStopped'));
					break;
				}

				const chunk = filesNeedingUpdate.slice(i, i + chunkSize);

				for (const file of chunk) {
					const word = file.basename;

					if (progressCallback) {
						progressCallback(result.updated + result.skipped + result.failed + 1, result.total, word);
					}

					try {
						const entry = await YoudaoService.lookup(word);
						if (entry) {
							await this.updateFileContent(file, entry);
							result.updated++;
						} else {
							result.skipped++;
						}

						await delay(100);
					} catch (error) {
						console.error(`Failed to update ${word}:`, error);
						result.failed++;
					}
				}

				if (i + chunkSize < filesNeedingUpdate.length && !this.shouldStop) {
					await delay(delayMs);
				}
			}

			new Notice(t('notice_batchCompleted', { 
				updated: result.updated, 
				skipped: result.skipped, 
				failed: result.failed 
			}));
		} catch (error) {
			console.error('Batch update error:', error);
			new Notice(t('notice_batchFailed', { error: error instanceof Error ? error.message : 'Unknown' }));
		} finally {
			this.isRunning = false;
		}

		return result;
	}

	private async findFilesNeedingUpdate(): Promise<TFile[]> {
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			return [];
		}

		const files: TFile[] = [];

		for (const file of folder.children) {
			if (file instanceof TFile && file.extension === 'md') {
				const content = await this.app.vault.read(file);
				if (this.needsUpdate(content)) {
					files.push(file);
				}
			}
		}

		return files;
	}

	private needsUpdate(content: string): boolean {
		if (content.includes(EUDIC_SYNC_CALLOUT)) {
			return true;
		}

		if (content.includes('status: eudic-sync')) {
			return true;
		}

		return false;
	}

	private async updateFileContent(file: TFile, entry: DictEntry): Promise<void> {
		const word = file.basename;
		const markdown = this.generateFullMarkdown(word, entry);
		await this.app.vault.modify(file, markdown);
	}

	private generateFullMarkdown(word: string, entry: DictEntry): string {
		const tags = new Set<string>(['vocabulary']);

		if (this.settings.saveTags && entry.tags.length > 0) {
			for (const tag of entry.tags) {
				tags.add(`exam/${tag}`);
			}
		}

		for (const def of entry.definitions) {
			if (def.pos) {
				const posTag = def.pos.replace(/\./g, '');
				tags.add(`pos/${posTag}`);
			}
		}

		const uniqueTags = Array.from(tags);

		const aliases: string[] = [];
		for (const item of entry.exchange) {
			aliases.push(item.value);
		}

		const uniqueAliases = [...new Set(aliases)].filter(a => a && a.trim() !== '');

		let yaml = '---\n';
		yaml += 'tags:\n';
		for (const tag of uniqueTags) {
			yaml += `  - ${escapeYamlString(tag)}\n`;
		}
		if (uniqueAliases.length > 0) {
			yaml += 'aliases:\n';
			for (const alias of uniqueAliases) {
				yaml += `  - ${escapeYamlString(alias)}\n`;
			}
		}
		yaml += '---\n\n';

		let content = `# ${word}\n\n`;

		if (entry.ph_uk || entry.ph_us) {
			content += `## ${t('view_pronunciation')}\n\n`;
			if (entry.ph_uk) {
				content += `- ${t('view_uk')}: \`/${entry.ph_uk}/\`\n`;
			}
			if (entry.ph_us) {
				content += `- ${t('view_us')}: \`/${entry.ph_us}/\`\n`;
			}
			content += '\n';
		}

		if (entry.definitions.length > 0) {
			content += `## ${t('view_definitions')}\n\n`;
			for (const def of entry.definitions) {
				const escapedTrans = def.trans.replace(/\[/g, '\\[');
				if (def.pos) {
					content += `- ***${def.pos}*** ${escapedTrans}\n`;
				} else {
					content += `- ${escapedTrans}\n`;
				}
			}
			content += '\n';
		}

		if (this.settings.showWebTrans && entry.webTrans && entry.webTrans.length > 0) {
			content += `## ${t('view_webTranslations')}\n\n`;
			for (const item of entry.webTrans) {
				const numberedValues = item.value.map((v, i) => `${i + 1}. ${v}`).join(' ');
				content += `- **${item.key}**: ${numberedValues}\n`;
			}
			content += '\n';
		}

		if (this.settings.showExamples && entry.bilingualExamples && entry.bilingualExamples.length > 0) {
			content += `## ${t('view_examples')}\n\n`;
			for (const example of entry.bilingualExamples) {
				content += `- ${example.eng}\n`;
				content += `  - ${example.chn}\n`;
			}
			content += '\n';
		}

		if (entry.exchange.length > 0) {
			content += `## ${t('view_wordForms')}\n\n`;
			for (const item of entry.exchange) {
				content += `- ${item.name}: ${item.value}\n`;
			}
			content += '\n';
		}

		return yaml + content;
	}

	async updateSingleWord(word: string): Promise<boolean> {
		try {
			const entry = await YoudaoService.lookup(word);
			if (!entry) {
				return false;
			}

			const folderPath = this.settings.folderPath;
			const filePath = `${folderPath}/${word}.md`;
			const file = this.app.vault.getAbstractFileByPath(filePath);

			if (file instanceof TFile) {
				await this.updateFileContent(file, entry);
				return true;
			}

			return false;
		} catch (error) {
			console.error(`Failed to update ${word}:`, error);
			return false;
		}
	}
}