import { App, Notice, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import { EudicService } from './eudic';
import { LinkDictSettings } from './settings';
import { t } from './i18n';

export interface SyncPreview {
	toUpload: number;
	toDownload: number;
	toDeleteFromCloud: number;
	toMarkDeleted: number;
}

export interface SyncResult {
	success: boolean;
	uploaded: number;
	downloaded: number;
	deletedFromCloud: number;
	markedDeleted: number;
	skipped: number;
	errors: string[];
}

export interface Frontmatter {
	tags?: string[];
	aliases?: string[];
	eudic_synced?: boolean;
	[key: string]: unknown;
}

const DEFAULT_API_DELAY_MS = 200;
const DEFAULT_SYNC_CONCURRENCY = 3;

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

export class SyncService {
	private app: App;
	private settings: LinkDictSettings;
	private eudicService: EudicService;
	private saveSettings: () => Promise<void>;
	private isSyncing: boolean = false;

	constructor(
		app: App,
		settings: LinkDictSettings,
		eudicService: EudicService,
		saveSettings: () => Promise<void>
	) {
		this.app = app;
		this.settings = settings;
		this.eudicService = eudicService;
		this.saveSettings = saveSettings;
	}

	isSyncInProgress(): boolean {
		return this.isSyncing;
	}

	async previewSync(): Promise<SyncPreview> {
		const preview: SyncPreview = {
			toUpload: 0,
			toDownload: 0,
			toDeleteFromCloud: this.settings.pendingDeletes.length,
			toMarkDeleted: 0,
		};

		const remoteSet = await this.fetchRemoteWordSet();
		const localSet = await this.fetchLocalWordSet();

		const remoteOnly = [...remoteSet].filter(w => !localSet.has(w));
		const localOnly = [...localSet].filter(w => !remoteSet.has(w));

		preview.toDownload = remoteOnly.length;

		for (const word of localOnly) {
			const syncStatus = await this.getFileSyncStatus(word);
			if (!syncStatus.eudicSynced) {
				preview.toUpload++;
			} else {
				preview.toMarkDeleted++;
			}
		}

		return preview;
	}

	needsDeleteConfirmation(preview: SyncPreview): boolean {
		return preview.toDeleteFromCloud > 5 || preview.toMarkDeleted > 5;
	}

	async sync(): Promise<SyncResult> {
		if (this.isSyncing) {
			return {
				success: false,
				uploaded: 0,
				downloaded: 0,
				deletedFromCloud: 0,
				markedDeleted: 0,
				skipped: 0,
				errors: ['Sync already in progress'],
			};
		}

		this.isSyncing = true;
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			deletedFromCloud: 0,
			markedDeleted: 0,
			skipped: 0,
			errors: [],
		};

		try {
			new Notice(t('notice_syncStarted'));

			await this.consumeTombstones(result);

			const remoteSet = await this.fetchRemoteWordSet();
			const localSet = await this.fetchLocalWordSet();

			await this.processRemoteOnlyWords(remoteSet, localSet, result);
			await this.processLocalOnlyWords(remoteSet, localSet, result);

			result.success = result.errors.length === 0;

			new Notice(t('notice_syncCompletedWithStats', {
				uploaded: result.uploaded,
				downloaded: result.downloaded,
			}));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMessage);
			new Notice(t('notice_syncFailed', { error: errorMessage }));
		} finally {
			this.isSyncing = false;
		}

		return result;
	}

	private async consumeTombstones(result: SyncResult): Promise<void> {
		const tombstones = [...this.settings.pendingDeletes];
		if (tombstones.length === 0) return;

		const listId = this.settings.eudicDefaultListId || '0';
		const apiDelay = this.settings.apiDelayMs || DEFAULT_API_DELAY_MS;

		for (const word of tombstones) {
			try {
				await this.eudicService.deleteWords(listId, [word]);
				result.deletedFromCloud++;
				await delay(apiDelay);
			} catch (error) {
				console.error(`Failed to delete "${word}" from cloud:`, error);
				result.errors.push(`Delete "${word}" from cloud failed`);
			}
		}

		this.settings.pendingDeletes = [];
		await this.saveSettings();
	}

	private async fetchRemoteWordSet(): Promise<Set<string>> {
		const words = new Set<string>();
		const listId = this.settings.eudicDefaultListId || '0';
		let page = 1;
		const pageSize = 100;

		while (true) {
			try {
				const batch = await this.eudicService.getWords(listId, 'en', page, pageSize);
				if (batch.length === 0) break;

				for (const w of batch) {
					const word = w.word?.trim().toLowerCase();
					if (word) {
						words.add(word);
					}
				}

				if (batch.length < pageSize) break;
				page++;
			} catch (error) {
				console.error('Failed to fetch remote words:', error);
				break;
			}
		}

		return words;
	}

	private async fetchLocalWordSet(): Promise<Set<string>> {
		const words = new Set<string>();
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			return words;
		}

		for (const file of folder.children) {
			if (file instanceof TFile && file.extension === 'md') {
				words.add(file.basename.toLowerCase());
			}
		}

		return words;
	}

	private async getFileSyncStatus(word: string): Promise<{ eudicSynced: boolean; file: TFile | null }> {
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!(file instanceof TFile)) {
			return { eudicSynced: false, file: null };
		}

		try {
			const content = await this.app.vault.read(file);
			const frontmatter = this.parseFrontmatter(content);
			return {
				eudicSynced: frontmatter?.eudic_synced === true,
				file,
			};
		} catch (error) {
			console.error(`Failed to read file "${word}":`, error);
			return { eudicSynced: false, file: null };
		}
	}

	private parseFrontmatter(content: string): Frontmatter | null {
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match || !match[1]) {
			return null;
		}

		try {
			return parseYaml(match[1]) as Frontmatter;
		} catch (error) {
			console.error('Failed to parse frontmatter:', error);
			return null;
		}
	}

	private async processRemoteOnlyWords(
		remoteSet: Set<string>,
		localSet: Set<string>,
		result: SyncResult
	): Promise<void> {
		const remoteOnly = [...remoteSet].filter(w => !localSet.has(w));
		if (remoteOnly.length === 0) return;

		const folderPath = this.settings.folderPath;
		await this.ensureFolderExists(folderPath);

		const total = remoteOnly.length;
		let current = 0;

		for (const word of remoteOnly) {
			current++;
			new Notice(t('notice_syncProgress', { current, total }));

			try {
				await this.createWordNote(word, true);
				result.downloaded++;
			} catch (error) {
				console.error(`Failed to create note for "${word}":`, error);
				result.errors.push(`Create "${word}" failed`);
			}

			await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
		}
	}

	private async processLocalOnlyWords(
		remoteSet: Set<string>,
		localSet: Set<string>,
		result: SyncResult
	): Promise<void> {
		const localOnly = [...localSet].filter(w => !remoteSet.has(w));
		if (localOnly.length === 0) return;

		const apiDelay = this.settings.apiDelayMs || DEFAULT_API_DELAY_MS;

		for (const word of localOnly) {
			try {
				const status = await this.getFileSyncStatus(word);

				if (!status.eudicSynced && status.file) {
					const listId = this.settings.eudicDefaultListId || '0';
					await this.eudicService.addWords(listId, [word]);
					await this.updateFrontmatter(status.file, { eudic_synced: true });
					result.uploaded++;
				} else if (status.eudicSynced && status.file) {
					await this.markAsCloudDeleted(status.file);
					result.markedDeleted++;
				} else {
					result.skipped++;
				}
			} catch (error) {
				console.error(`Failed to process local word "${word}":`, error);
				result.errors.push(`Process "${word}" failed`);
			}

			await delay(apiDelay);
		}
	}

	private async createWordNote(word: string, markSynced: boolean): Promise<void> {
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;

		const exists = await this.app.vault.adapter.exists(filePath);
		if (exists) return;

		const frontmatter: Frontmatter = {
			tags: ['vocabulary'],
			eudic_synced: markSynced,
		};

		let content = `---\n${stringifyYaml(frontmatter)}---\n\n`;
		content += `# ${word}\n\n`;
		content += `## ${t('view_definitions')}\n\n`;
		content += `*Definition will be fetched on batch update*\n\n`;
		content += `> [!info] Eudic Sync\n`;
		content += `> This note was created from eudic sync. [🔄 Click here to update dictionary details](obsidian://linkdict?action=update&word=${encodeURIComponent(word)})\n`;

		await this.app.vault.create(filePath, content);
	}

	private async updateFrontmatter(file: TFile, updates: Partial<Frontmatter>): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

			let frontmatter: Frontmatter;
			let body: string;

			if (match && match[1] && match[2]) {
				frontmatter = parseYaml(match[1]) as Frontmatter;
				body = match[2];
			} else {
				frontmatter = { tags: ['vocabulary'] };
				body = content;
			}

			for (const [key, value] of Object.entries(updates)) {
				(frontmatter as Record<string, unknown>)[key] = value;
			}

			const newContent = `---\n${stringifyYaml(frontmatter)}---\n${body}`;
			await this.app.vault.modify(file, newContent);
		} catch (error) {
			console.error(`Failed to update frontmatter for "${file.basename}":`, error);
			throw error;
		}
	}

	private async markAsCloudDeleted(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

			let frontmatter: Frontmatter;
			let body: string;

			if (match && match[1] && match[2]) {
				frontmatter = parseYaml(match[1]) as Frontmatter;
				body = match[2];
			} else {
				frontmatter = { tags: ['vocabulary'] };
				body = content;
			}

			if (!frontmatter.tags) {
				frontmatter.tags = ['vocabulary'];
			}
			if (!frontmatter.tags.includes('linkdict/cloud-deleted')) {
				frontmatter.tags.push('linkdict/cloud-deleted');
			}
			frontmatter.eudic_synced = false;

			const newContent = `---\n${stringifyYaml(frontmatter)}---\n${body}`;
			await this.app.vault.modify(file, newContent);
		} catch (error) {
			console.error(`Failed to mark "${file.basename}" as cloud deleted:`, error);
			throw error;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const exists = await this.app.vault.adapter.exists(folderPath);
		if (!exists) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	async handleFileCreated(file: TFile): Promise<void> {
		if (file.extension !== 'md') return;

		const folderPath = this.settings.folderPath;
		if (!file.path.startsWith(folderPath)) return;

		const word = file.basename;
		if (!word || !/^[a-zA-Z]+(-[a-zA-Z]+)*$/.test(word)) return;

		if (!this.settings.autoAddToEudic) return;

		try {
			const listId = this.settings.eudicDefaultListId || '0';
			await this.eudicService.addWords(listId, [word]);
			await this.updateFrontmatter(file, { eudic_synced: true });
			console.debug(`Auto-added "${word}" to eudic`);
		} catch (error) {
			console.error(`Failed to auto-add "${word}" to eudic:`, error);
		}
	}

	handleFileDeleted(file: TFile): void {
		if (file.extension !== 'md') return;

		const folderPath = this.settings.folderPath;
		if (!file.path.startsWith(folderPath)) return;

		const word = file.basename;
		if (!word) return;

		const lowerWord = word.toLowerCase();

		if (!this.settings.pendingDeletes.includes(lowerWord)) {
			this.settings.pendingDeletes.push(lowerWord);
			void this.saveSettings();
		}
	}

	clearPendingDeletes(): void {
		this.settings.pendingDeletes = [];
		void this.saveSettings();
	}

	getPendingDeletesCount(): number {
		return this.settings.pendingDeletes.length;
	}
}