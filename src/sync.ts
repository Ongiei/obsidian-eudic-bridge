import { App, Notice, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import { EudicService } from './eudic';
import { LinkDictSettings } from './settings';
import { t } from './i18n';

export type DictSource = 'eudic' | 'youdao';

export interface SyncChange {
	word: string;
	action: 'download' | 'upload' | 'mark_deleted' | 'delete_from_cloud';
	reason: string;
}

export interface SyncDryRunResult {
	toDownload: SyncChange[];
	toUpload: SyncChange[];
	toMarkDeleted: SyncChange[];
	toDeleteFromCloud: SyncChange[];
	errors: string[];
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
	dict_source?: DictSource;
	[key: string]: unknown;
}

export interface EudicWordData {
	word: string;
	exp?: string;
}

const DEFAULT_API_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export class SyncService {
	private app: App;
	private settings: LinkDictSettings;
	private eudicService: EudicService;
	private saveSettings: () => Promise<void>;
	private isSyncing: boolean = false;
	private shouldAbort: boolean = false;
	private cachedRemoteData: Map<string, EudicWordData> | null = null;

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

	abort(): void {
		this.shouldAbort = true;
	}

	async dryRun(): Promise<SyncDryRunResult> {
		const result: SyncDryRunResult = {
			toDownload: [],
			toUpload: [],
			toMarkDeleted: [],
			toDeleteFromCloud: [],
			errors: [],
		};

		try {
			this.cachedRemoteData = await this.fetchRemoteWordData();
			const localData = await this.fetchLocalWordData();

			const remoteSet = new Set(this.cachedRemoteData.keys());
			const localSet = new Set(localData.keys());

			for (const [word] of this.cachedRemoteData) {
				if (!localSet.has(word)) {
					result.toDownload.push({
						word,
						action: 'download',
						reason: t('sync_reason_remote_only'),
					});
				}
			}

			for (const [word, data] of localData) {
				if (!remoteSet.has(word)) {
					if (data.eudicSynced === true) {
						result.toMarkDeleted.push({
							word,
							action: 'mark_deleted',
							reason: t('sync_reason_cloud_deleted'),
						});
					} else {
						result.toUpload.push({
							word,
							action: 'upload',
							reason: t('sync_reason_local_new'),
						});
					}
				}
			}

			for (const word of this.settings.pendingDeletes) {
				if (remoteSet.has(word)) {
					result.toDeleteFromCloud.push({
						word,
						action: 'delete_from_cloud',
						reason: t('sync_reason_local_deleted'),
					});
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMsg);
		}

		return result;
	}

	async executeSync(
		dryRunResult: SyncDryRunResult, 
		progressCallback?: (current: number, total: number, word: string) => void
	): Promise<SyncResult> {
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
		this.shouldAbort = false;

		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			deletedFromCloud: 0,
			markedDeleted: 0,
			skipped: 0,
			errors: [...dryRunResult.errors],
		};

		const totalOps = dryRunResult.toDeleteFromCloud.length + 
			dryRunResult.toDownload.length + 
			dryRunResult.toUpload.length + 
			dryRunResult.toMarkDeleted.length;

		let current = 0;

		try {
			// Phase 1: Delete from cloud (tombstones)
			for (const change of dryRunResult.toDeleteFromCloud) {
				if (this.shouldAbort) {
					console.log('[Sync] Aborted during delete from cloud phase');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeDeleteFromCloud(change.word, result);
				} catch (err) {
					console.error(`[Sync] Error deleting ${change.word} from cloud:`, err);
					result.errors.push(`Delete "${change.word}" from cloud failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
			}

			// Clean up tombstones
			this.settings.pendingDeletes = this.settings.pendingDeletes.filter(
				w => !dryRunResult.toDeleteFromCloud.some(c => c.word === w)
			);
			await this.saveSettings();

			// Phase 2: Download from cloud (use cached data)
			const remoteData = this.cachedRemoteData || new Map();

			for (const change of dryRunResult.toDownload) {
				if (this.shouldAbort) {
					console.log('[Sync] Aborted during download phase');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					const wordData = remoteData.get(change.word);
					await this.executeDownload(change.word, wordData?.exp, result);
				} catch (err) {
					console.error(`[Sync] Error downloading ${change.word}:`, err);
					result.errors.push(`Download "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
			}

			// Phase 3: Upload to cloud
			for (const change of dryRunResult.toUpload) {
				if (this.shouldAbort) {
					console.log('[Sync] Aborted during upload phase');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeUpload(change.word, result);
				} catch (err) {
					console.error(`[Sync] Error uploading ${change.word}:`, err);
					result.errors.push(`Upload "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
			}

			// Phase 4: Mark as cloud-deleted
			for (const change of dryRunResult.toMarkDeleted) {
				if (this.shouldAbort) {
					console.log('[Sync] Aborted during mark deleted phase');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeMarkDeleted(change.word, result);
				} catch (err) {
					console.error(`[Sync] Error marking ${change.word} as deleted:`, err);
					result.errors.push(`Mark "${change.word}" deleted failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
			}

			result.success = !this.shouldAbort && result.errors.length === dryRunResult.errors.length;
			
			console.log(`[Sync] Completed. Downloaded: ${result.downloaded}, Uploaded: ${result.uploaded}, Marked deleted: ${result.markedDeleted}, Errors: ${result.errors.length}`);
			
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.error('[Sync] Fatal error:', errorMsg);
			result.errors.push(`Fatal error: ${errorMsg}`);
		} finally {
			this.isSyncing = false;
			this.cachedRemoteData = null;
		}

		return result;
	}

	private async fetchRemoteWordData(): Promise<Map<string, EudicWordData>> {
		const data = new Map<string, EudicWordData>();
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
						data.set(word, { word, exp: w.exp });
					}
				}

				if (batch.length < pageSize) break;
				page++;
			} catch (error) {
				console.error('[Sync] Failed to fetch remote words:', error);
				throw error;
			}
		}

		console.log(`[Sync] Fetched ${data.size} words from remote`);
		return data;
	}

	private async fetchLocalWordData(): Promise<Map<string, { eudicSynced: boolean; dictSource?: DictSource }>> {
		const data = new Map<string, { eudicSynced: boolean; dictSource?: DictSource }>();
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			console.log(`[Sync] Local folder not found: ${folderPath}`);
			return data;
		}

		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		}

		console.log(`[Sync] Scanning ${files.length} local files...`);

		for (const file of files) {
			const word = file.basename.toLowerCase();
			try {
				const content = await this.app.vault.read(file);
				const fm = this.parseFrontmatter(content);
				data.set(word, {
					eudicSynced: fm?.eudic_synced === true,
					dictSource: fm?.dict_source as DictSource | undefined,
				});
			} catch (readError) {
				console.warn(`[Sync] Could not read file ${file.path}:`, readError);
				data.set(word, { eudicSynced: false });
			}
		}

		console.log(`[Sync] Scanned ${data.size} local words`);
		return data;
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

	private async executeDeleteFromCloud(word: string, result: SyncResult): Promise<void> {
		const listId = this.settings.eudicDefaultListId || '0';
		await this.eudicService.deleteWords(listId, [word]);
		result.deletedFromCloud++;
		console.log(`[Sync] Deleted "${word}" from cloud`);
	}

	private async executeDownload(word: string, eudicExp: string | undefined, result: SyncResult): Promise<void> {
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;

		const exists = await this.app.vault.adapter.exists(filePath);
		if (exists) {
			console.log(`[Sync] File already exists: ${word}`);
			result.skipped++;
			return;
		}

		await this.ensureFolderExists(folderPath);

		const frontmatter: Frontmatter = {
			tags: ['vocabulary'],
			eudic_synced: true,
			dict_source: 'eudic',
		};

		let content = `---\n${stringifyYaml(frontmatter)}---\n\n`;
		content += `# ${word}\n\n`;
		content += `## ${t('view_definitions')}\n\n`;
		
		if (eudicExp) {
			content += `- ${eudicExp}\n\n`;
		} else {
			content += `*Definition pending update*\n\n`;
		}

		content += `> [!info] Eudic Sync\n`;
		content += `> [🔄 ${t('sync_clickToUpdate')}](obsidian://linkdict?action=update&word=${encodeURIComponent(word)})\n`;

		await this.app.vault.create(filePath, content);
		result.downloaded++;
		console.log(`[Sync] Downloaded "${word}"`);
	}

	private async executeUpload(word: string, result: SyncResult): Promise<void> {
		const listId = this.settings.eudicDefaultListId || '0';
		await this.eudicService.addWords(listId, [word]);

		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			await this.safeProcessFrontmatter(file, (fm) => {
				fm.eudic_synced = true;
			});
		}

		result.uploaded++;
		console.log(`[Sync] Uploaded "${word}"`);
	}

	private async executeMarkDeleted(word: string, result: SyncResult): Promise<void> {
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!(file instanceof TFile)) {
			console.log(`[Sync] File not found for mark deleted: ${word}`);
			result.skipped++;
			return;
		}

		await this.safeProcessFrontmatter(file, (fm) => {
			if (!fm.tags) {
				fm.tags = ['vocabulary'];
			}
			if (!fm.tags.includes('linkdict/cloud-deleted')) {
				fm.tags.push('linkdict/cloud-deleted');
			}
			fm.eudic_synced = false;
		});

		result.markedDeleted++;
		console.log(`[Sync] Marked "${word}" as cloud-deleted`);
	}

	private async safeProcessFrontmatter(
		file: TFile, 
		processor: (fm: Frontmatter) => void
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			processor(fm as unknown as Frontmatter);
		});
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
			await this.safeProcessFrontmatter(file, (fm) => {
				fm.eudic_synced = true;
			});
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