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
	console.log(`[DEBUG] delay(${ms}ms)`);
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
	private syncInProgress: boolean = false;

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
		console.log('[DEBUG] SyncService constructed');
	}

	isSyncInProgress(): boolean {
		console.log(`[DEBUG] isSyncInProgress: ${this.isSyncing}`);
		return this.isSyncing;
	}
	
	isCurrentlySyncing(): boolean {
		return this.syncInProgress;
	}

	abort(): void {
		console.log('[DEBUG] abort() called');
		this.shouldAbort = true;
	}

	async dryRun(): Promise<SyncDryRunResult> {
		console.log('[DEBUG] dryRun() start');
		const result: SyncDryRunResult = {
			toDownload: [],
			toUpload: [],
			toMarkDeleted: [],
			toDeleteFromCloud: [],
			errors: [],
		};

		try {
			console.log('[DEBUG] Fetching remote data...');
			this.cachedRemoteData = await this.fetchRemoteWordData();
			console.log(`[DEBUG] Remote data fetched: ${this.cachedRemoteData.size} words`);
			
			console.log('[DEBUG] Fetching local data...');
			const localData = await this.fetchLocalWordData();
			console.log(`[DEBUG] Local data fetched: ${localData.size} words`);

			const remoteSet = new Set(this.cachedRemoteData.keys());
			const localSet = new Set(localData.keys());

			console.log(`[DEBUG] Starting diff calculation...`);

			for (const [word] of this.cachedRemoteData) {
				if (!localSet.has(word)) {
					result.toDownload.push({
						word,
						action: 'download',
						reason: t('sync_reason_remote_only'),
					});
				}
			}
			console.log(`[DEBUG] toDownload: ${result.toDownload.length}`);

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
			console.log(`[DEBUG] toUpload: ${result.toUpload.length}, toMarkDeleted: ${result.toMarkDeleted.length}`);

			for (const word of this.settings.pendingDeletes) {
				if (remoteSet.has(word)) {
					result.toDeleteFromCloud.push({
						word,
						action: 'delete_from_cloud',
						reason: t('sync_reason_local_deleted'),
					});
				}
			}
			console.log(`[DEBUG] toDeleteFromCloud: ${result.toDeleteFromCloud.length}`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.error('[DEBUG] dryRun error:', errorMsg);
			result.errors.push(errorMsg);
		}

		console.log(`[DEBUG] dryRun() complete`);
		return result;
	}

	async executeSync(
		dryRunResult: SyncDryRunResult, 
		progressCallback?: (current: number, total: number, word: string) => void
	): Promise<SyncResult> {
		console.log('[DEBUG] executeSync() called');
		console.log(`[DEBUG] isSyncing: ${this.isSyncing}`);
		
		if (this.isSyncing) {
			console.log('[DEBUG] Already syncing, returning early');
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
		this.syncInProgress = true;
		console.log('[DEBUG] Set isSyncing=true, shouldAbort=false, syncInProgress=true');

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

		console.log(`[DEBUG] totalOps: ${totalOps}`);

		let current = 0;

		try {
			// Phase 1: Delete from cloud (tombstones)
			console.log(`[DEBUG] === Phase 1: Delete from cloud (${dryRunResult.toDeleteFromCloud.length} items) ===`);
			let phaseIndex = 0;
			for (const change of dryRunResult.toDeleteFromCloud) {
				phaseIndex++;
				console.log(`[DEBUG] Phase 1 [${phaseIndex}/${dryRunResult.toDeleteFromCloud.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					console.log('[DEBUG] shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeDeleteFromCloud(change.word, result);
					console.log(`[DEBUG] Phase 1 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 1 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Delete "${change.word}" from cloud failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				console.log(`[DEBUG] Phase 1 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				console.log(`[DEBUG] Phase 1 [${phaseIndex}] delay done`);
			}
			console.log(`[DEBUG] === Phase 1 complete ===`);

			// Clean up tombstones
			this.settings.pendingDeletes = this.settings.pendingDeletes.filter(
				w => !dryRunResult.toDeleteFromCloud.some(c => c.word === w)
			);
			await this.saveSettings();
			console.log('[DEBUG] Tombstones cleaned');

			// Phase 2: Download from cloud (use cached data)
			console.log(`[DEBUG] === Phase 2: Download (${dryRunResult.toDownload.length} items) ===`);
			const remoteData = this.cachedRemoteData || new Map();
			phaseIndex = 0;
			
			for (const change of dryRunResult.toDownload) {
				phaseIndex++;
				console.log(`[DEBUG] Phase 2 [${phaseIndex}/${dryRunResult.toDownload.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					console.log('[DEBUG] shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					const wordData = remoteData.get(change.word);
					await this.executeDownload(change.word, wordData?.exp, result);
					console.log(`[DEBUG] Phase 2 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 2 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Download "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				console.log(`[DEBUG] Phase 2 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				console.log(`[DEBUG] Phase 2 [${phaseIndex}] delay done`);
			}
			console.log(`[DEBUG] === Phase 2 complete ===`);

			// Phase 3: Upload to cloud
			console.log(`[DEBUG] === Phase 3: Upload (${dryRunResult.toUpload.length} items) ===`);
			phaseIndex = 0;
			
			for (const change of dryRunResult.toUpload) {
				phaseIndex++;
				console.log(`[DEBUG] Phase 3 [${phaseIndex}/${dryRunResult.toUpload.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					console.log('[DEBUG] shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeUpload(change.word, result);
					console.log(`[DEBUG] Phase 3 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 3 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Upload "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				console.log(`[DEBUG] Phase 3 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				console.log(`[DEBUG] Phase 3 [${phaseIndex}] delay done`);
			}
			console.log(`[DEBUG] === Phase 3 complete ===`);

			// Phase 4: Mark as cloud-deleted
			console.log(`[DEBUG] === Phase 4: Mark deleted (${dryRunResult.toMarkDeleted.length} items) ===`);
			phaseIndex = 0;
			
			for (const change of dryRunResult.toMarkDeleted) {
				phaseIndex++;
				console.log(`[DEBUG] Phase 4 [${phaseIndex}/${dryRunResult.toMarkDeleted.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					console.log('[DEBUG] shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeMarkDeleted(change.word, result);
					console.log(`[DEBUG] Phase 4 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 4 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Mark "${change.word}" deleted failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				console.log(`[DEBUG] Phase 4 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				console.log(`[DEBUG] Phase 4 [${phaseIndex}] delay done`);
			}
			console.log(`[DEBUG] === Phase 4 complete ===`);

			result.success = !this.shouldAbort && result.errors.length === dryRunResult.errors.length;
			
			console.log(`[DEBUG] Final result - Downloaded: ${result.downloaded}, Uploaded: ${result.uploaded}, MarkedDeleted: ${result.markedDeleted}, Errors: ${result.errors.length}`);
			
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.error('[DEBUG] FATAL ERROR in executeSync:', errorMsg);
			console.error('[DEBUG] Stack:', error instanceof Error ? error.stack : 'No stack');
			result.errors.push(`Fatal error: ${errorMsg}`);
		} finally {
			console.log('[DEBUG] Setting isSyncing=false, syncInProgress=false');
			this.isSyncing = false;
			this.syncInProgress = false;
			this.cachedRemoteData = null;
		}

		console.log(`[DEBUG] executeSync() returning`);
		return result;
	}

	private async fetchRemoteWordData(): Promise<Map<string, EudicWordData>> {
		console.log('[DEBUG] fetchRemoteWordData() start');
		const data = new Map<string, EudicWordData>();
		const listId = this.settings.eudicDefaultListId || '0';
		let page = 1;
		const pageSize = 100;

		while (true) {
			console.log(`[DEBUG] Fetching page ${page}...`);
			try {
				const batch = await this.eudicService.getWords(listId, 'en', page, pageSize);
				console.log(`[DEBUG] Page ${page}: ${batch.length} words`);
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
				console.error('[DEBUG] Error fetching page:', error);
				throw error;
			}
		}

		console.log(`[DEBUG] fetchRemoteWordData() complete: ${data.size} words`);
		return data;
	}

	private async fetchLocalWordData(): Promise<Map<string, { eudicSynced: boolean; dictSource?: DictSource }>> {
		console.log('[DEBUG] fetchLocalWordData() start');
		const data = new Map<string, { eudicSynced: boolean; dictSource?: DictSource }>();
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			console.log(`[DEBUG] Local folder not found: ${folderPath}`);
			return data;
		}

		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		}

		console.log(`[DEBUG] Scanning ${files.length} files...`);

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
				console.warn(`[DEBUG] Could not read ${file.path}:`, readError);
				data.set(word, { eudicSynced: false });
			}
		}

		console.log(`[DEBUG] fetchLocalWordData() complete: ${data.size} words`);
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
		console.log(`[DEBUG] executeDeleteFromCloud(${word}) start`);
		const listId = this.settings.eudicDefaultListId || '0';
		await this.eudicService.deleteWords(listId, [word]);
		result.deletedFromCloud++;
		console.log(`[DEBUG] executeDeleteFromCloud(${word}) done`);
	}

	private async executeDownload(word: string, eudicExp: string | undefined, result: SyncResult): Promise<void> {
		console.log(`[DEBUG] executeDownload(${word}) start`);
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;

		console.log(`[DEBUG] Checking if exists: ${filePath}`);
		const exists = await this.app.vault.adapter.exists(filePath);
		console.log(`[DEBUG] Exists: ${exists}`);
		
		if (exists) {
			console.log(`[DEBUG] File already exists, skipping`);
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

		console.log(`[DEBUG] Creating file: ${filePath}`);
		await this.app.vault.create(filePath, content);
		console.log(`[DEBUG] File created`);
		result.downloaded++;
	}

	private async executeUpload(word: string, result: SyncResult): Promise<void> {
		console.log(`[DEBUG] executeUpload(${word}) start`);
		const listId = this.settings.eudicDefaultListId || '0';
		
		console.log(`[DEBUG] Calling eudicService.addWords...`);
		await this.eudicService.addWords(listId, [word]);
		console.log(`[DEBUG] addWords done`);

		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			console.log(`[DEBUG] Updating frontmatter...`);
			await this.safeProcessFrontmatter(file, (fm) => {
				fm.eudic_synced = true;
			});
			console.log(`[DEBUG] Frontmatter updated`);
		} else {
			console.log(`[DEBUG] File not found for frontmatter update: ${filePath}`);
		}

		result.uploaded++;
		console.log(`[DEBUG] executeUpload(${word}) done`);
	}

	private async executeMarkDeleted(word: string, result: SyncResult): Promise<void> {
		console.log(`[DEBUG] executeMarkDeleted(${word}) start`);
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!(file instanceof TFile)) {
			console.log(`[DEBUG] File not found, skipping`);
			result.skipped++;
			return;
		}

		console.log(`[DEBUG] Updating frontmatter for cloud-deleted...`);
		await this.safeProcessFrontmatter(file, (fm) => {
			if (!fm.tags) {
				fm.tags = ['vocabulary'];
			}
			if (!fm.tags.includes('linkdict/cloud-deleted')) {
				fm.tags.push('linkdict/cloud-deleted');
			}
			fm.eudic_synced = false;
		});
		console.log(`[DEBUG] Frontmatter updated`);

		result.markedDeleted++;
		console.log(`[DEBUG] executeMarkDeleted(${word}) done`);
	}

	private async safeProcessFrontmatter(
		file: TFile, 
		processor: (fm: Frontmatter) => void
	): Promise<void> {
		console.log(`[DEBUG] safeProcessFrontmatter(${file.path}) start`);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			console.log(`[DEBUG] Inside processFrontMatter callback`);
			processor(fm as unknown as Frontmatter);
			console.log(`[DEBUG] processor() done`);
		});
		console.log(`[DEBUG] safeProcessFrontmatter done`);
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		console.log(`[DEBUG] ensureFolderExists(${folderPath})`);
		const exists = await this.app.vault.adapter.exists(folderPath);
		if (!exists) {
			console.log(`[DEBUG] Creating folder...`);
			await this.app.vault.createFolder(folderPath);
			console.log(`[DEBUG] Folder created`);
		}
	}

	async handleFileCreated(file: TFile): Promise<void> {
		console.log(`[DEBUG] handleFileCreated(${file.path}) called, syncInProgress=${this.syncInProgress}`);
		
		if (this.syncInProgress) {
			console.log(`[DEBUG] Skipping handleFileCreated - sync in progress`);
			return;
		}
		
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