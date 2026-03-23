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

// Global log storage for debugging via CLI
const SYNC_LOGS: string[] = [];
const MAX_LOGS = 1000;

function log(message: string): void {
	const timestamp = new Date().toISOString().substr(11, 12);
	const entry = `[${timestamp}] ${message}`;
	console.log(entry);
	SYNC_LOGS.push(entry);
	if (SYNC_LOGS.length > MAX_LOGS) {
		SYNC_LOGS.shift();
	}
}

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
		// Expose logs for CLI debugging
		(window as unknown as { __linkDictLogs: string[] }).__linkDictLogs = SYNC_LOGS;
	}

	isSyncInProgress(): boolean {
		log(`isSyncInProgress: ${this.isSyncing}`);
		return this.isSyncing;
	}
	
	isCurrentlySyncing(): boolean {
		return this.syncInProgress;
	}
	
	getLogs(): string[] {
		return [...SYNC_LOGS];
	}
	
	clearLogs(): void {
		SYNC_LOGS.length = 0;
	}

	abort(): void {
		log('abort() called');
		this.shouldAbort = true;
	}

	async dryRun(): Promise<SyncDryRunResult> {
		log('dryRun() start');
		const result: SyncDryRunResult = {
			toDownload: [],
			toUpload: [],
			toMarkDeleted: [],
			toDeleteFromCloud: [],
			errors: [],
		};

		try {
			log('Fetching remote data...');
			this.cachedRemoteData = await this.fetchRemoteWordData();
			log(`Remote data fetched: ${this.cachedRemoteData.size} words`);
			
			log('Fetching local data...');
			const localData = await this.fetchLocalWordData();
			log(`Local data fetched: ${localData.size} words`);

			const remoteSet = new Set(this.cachedRemoteData.keys());
			const localSet = new Set(localData.keys());

			log('Starting diff calculation...');

			for (const [word] of this.cachedRemoteData) {
				if (!localSet.has(word)) {
					result.toDownload.push({
						word,
						action: 'download',
						reason: t('sync_reason_remote_only'),
					});
				}
			}
			log(`toDownload: ${result.toDownload.length}`);

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
			log(`toUpload: ${result.toUpload.length}, toMarkDeleted: ${result.toMarkDeleted.length}`);

			for (const word of this.settings.pendingDeletes) {
				if (remoteSet.has(word)) {
					result.toDeleteFromCloud.push({
						word,
						action: 'delete_from_cloud',
						reason: t('sync_reason_local_deleted'),
					});
				}
			}
			log(`toDeleteFromCloud: ${result.toDeleteFromCloud.length}`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.error('[DEBUG] dryRun error:', errorMsg);
			result.errors.push(errorMsg);
		}

		log('dryRun() complete');
		return result;
	}

	async executeSync(
		dryRunResult: SyncDryRunResult, 
		progressCallback?: (current: number, total: number, word: string) => void
	): Promise<SyncResult> {
		log('executeSync() called');
		log(`isSyncing: ${this.isSyncing}`);
		
		if (this.isSyncing) {
			log('Already syncing, returning early');
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
		log('Set isSyncing=true, shouldAbort=false, syncInProgress=true');

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

		log(`totalOps: ${totalOps}`);

		let current = 0;

		try {
			// Phase 1: Delete from cloud (tombstones)
			log(`=== Phase 1: Delete from cloud (${dryRunResult.toDeleteFromCloud.length} items) ===`);
			let phaseIndex = 0;
			for (const change of dryRunResult.toDeleteFromCloud) {
				phaseIndex++;
				log(`Phase 1 [${phaseIndex}/${dryRunResult.toDeleteFromCloud.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					log('shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeDeleteFromCloud(change.word, result);
					log(`Phase 1 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 1 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Delete "${change.word}" from cloud failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				log(`Phase 1 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				log(`Phase 1 [${phaseIndex}] delay done`);
			}
			log(`=== Phase 1 complete ===`);

			// Clean up tombstones
			this.settings.pendingDeletes = this.settings.pendingDeletes.filter(
				w => !dryRunResult.toDeleteFromCloud.some(c => c.word === w)
			);
			await this.saveSettings();
			log('Tombstones cleaned');

			// Phase 2: Download from cloud (use cached data)
			log(`=== Phase 2: Download (${dryRunResult.toDownload.length} items) ===`);
			const remoteData = this.cachedRemoteData || new Map();
			phaseIndex = 0;
			
			for (const change of dryRunResult.toDownload) {
				phaseIndex++;
				log(`Phase 2 [${phaseIndex}/${dryRunResult.toDownload.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					log('shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					const wordData = remoteData.get(change.word);
					await this.executeDownload(change.word, wordData?.exp, result);
					log(`Phase 2 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 2 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Download "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				log(`Phase 2 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				log(`Phase 2 [${phaseIndex}] delay done`);
			}
			log(`=== Phase 2 complete ===`);

			// Phase 3: Upload to cloud
			log(`=== Phase 3: Upload (${dryRunResult.toUpload.length} items) ===`);
			phaseIndex = 0;
			
			for (const change of dryRunResult.toUpload) {
				phaseIndex++;
				log(`Phase 3 [${phaseIndex}/${dryRunResult.toUpload.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					log('shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeUpload(change.word, result);
					log(`Phase 3 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 3 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Upload "${change.word}" failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				log(`Phase 3 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				log(`Phase 3 [${phaseIndex}] delay done`);
			}
			log(`=== Phase 3 complete ===`);

			// Phase 4: Mark as cloud-deleted
			log(`=== Phase 4: Mark deleted (${dryRunResult.toMarkDeleted.length} items) ===`);
			phaseIndex = 0;
			
			for (const change of dryRunResult.toMarkDeleted) {
				phaseIndex++;
				log(`Phase 4 [${phaseIndex}/${dryRunResult.toMarkDeleted.length}] Processing: ${change.word}`);
				
				if (this.shouldAbort) {
					log('shouldAbort=true, breaking');
					break;
				}
				current++;
				progressCallback?.(current, totalOps, change.word);
				
				try {
					await this.executeMarkDeleted(change.word, result);
					log(`Phase 4 [${phaseIndex}] SUCCESS: ${change.word}`);
				} catch (err) {
					console.error(`[DEBUG] Phase 4 [${phaseIndex}] ERROR: ${change.word}`, err);
					result.errors.push(`Mark "${change.word}" deleted failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				
				log(`Phase 4 [${phaseIndex}] delay...`);
				await delay(this.settings.apiDelayMs || DEFAULT_API_DELAY_MS);
				log(`Phase 4 [${phaseIndex}] delay done`);
			}
			log(`=== Phase 4 complete ===`);

			result.success = !this.shouldAbort && result.errors.length === dryRunResult.errors.length;
			
			log(`Final result - Downloaded: ${result.downloaded}, Uploaded: ${result.uploaded}, MarkedDeleted: ${result.markedDeleted}, Errors: ${result.errors.length}`);
			
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.error('[DEBUG] FATAL ERROR in executeSync:', errorMsg);
			console.error('[DEBUG] Stack:', error instanceof Error ? error.stack : 'No stack');
			result.errors.push(`Fatal error: ${errorMsg}`);
		} finally {
			log('Setting isSyncing=false, syncInProgress=false');
			this.isSyncing = false;
			this.syncInProgress = false;
			this.cachedRemoteData = null;
		}

		log(`executeSync() returning`);
		return result;
	}

	private async fetchRemoteWordData(): Promise<Map<string, EudicWordData>> {
		log('fetchRemoteWordData() start');
		const data = new Map<string, EudicWordData>();
		const listId = this.settings.eudicDefaultListId || '0';
		let page = 1;
		const pageSize = 100;

		while (true) {
			log(`Fetching page ${page}...`);
			try {
				const batch = await this.eudicService.getWords(listId, 'en', page, pageSize);
				log(`Page ${page}: ${batch.length} words`);
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

		log(`fetchRemoteWordData() complete: ${data.size} words`);
		return data;
	}

	private async fetchLocalWordData(): Promise<Map<string, { eudicSynced: boolean; dictSource?: DictSource }>> {
		log('fetchLocalWordData() start');
		const data = new Map<string, { eudicSynced: boolean; dictSource?: DictSource }>();
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			log(`Local folder not found: ${folderPath}`);
			return data;
		}

		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		}

		log(`Scanning ${files.length} files...`);

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

		log(`fetchLocalWordData() complete: ${data.size} words`);
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
		log(`executeDeleteFromCloud(${word}) start`);
		const listId = this.settings.eudicDefaultListId || '0';
		await this.eudicService.deleteWords(listId, [word]);
		result.deletedFromCloud++;
		log(`executeDeleteFromCloud(${word}) done`);
	}

	private async executeDownload(word: string, eudicExp: string | undefined, result: SyncResult): Promise<void> {
		log(`executeDownload(${word}) start`);
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;

		log(`Checking if exists: ${filePath}`);
		const exists = await this.app.vault.adapter.exists(filePath);
		log(`Exists: ${exists}`);
		
		if (exists) {
			log(`File already exists, skipping`);
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

		log(`Creating file: ${filePath}`);
		await this.app.vault.create(filePath, content);
		log(`File created`);
		result.downloaded++;
	}

	private async executeUpload(word: string, result: SyncResult): Promise<void> {
		log(`executeUpload(${word}) start`);
		const listId = this.settings.eudicDefaultListId || '0';
		
		log(`Calling eudicService.addWords...`);
		await this.eudicService.addWords(listId, [word]);
		log(`addWords done`);

		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			log(`Updating frontmatter...`);
			await this.safeProcessFrontmatter(file, (fm) => {
				fm.eudic_synced = true;
			});
			log(`Frontmatter updated`);
		} else {
			log(`File not found for frontmatter update: ${filePath}`);
		}

		result.uploaded++;
		log(`executeUpload(${word}) done`);
	}

	private async executeMarkDeleted(word: string, result: SyncResult): Promise<void> {
		log(`executeMarkDeleted(${word}) start`);
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!(file instanceof TFile)) {
			log(`File not found, skipping`);
			result.skipped++;
			return;
		}

		log(`Updating frontmatter for cloud-deleted...`);
		await this.safeProcessFrontmatter(file, (fm) => {
			if (!fm.tags) {
				fm.tags = ['vocabulary'];
			}
			if (!fm.tags.includes('linkdict/cloud-deleted')) {
				fm.tags.push('linkdict/cloud-deleted');
			}
			fm.eudic_synced = false;
		});
		log(`Frontmatter updated`);

		result.markedDeleted++;
		log(`executeMarkDeleted(${word}) done`);
	}

	private async safeProcessFrontmatter(
		file: TFile, 
		processor: (fm: Frontmatter) => void
	): Promise<void> {
		log(`safeProcessFrontmatter(${file.path}) start`);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			log(`Inside processFrontMatter callback`);
			processor(fm as unknown as Frontmatter);
			log(`processor() done`);
		});
		log(`safeProcessFrontmatter done`);
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		log(`ensureFolderExists(${folderPath})`);
		const exists = await this.app.vault.adapter.exists(folderPath);
		if (!exists) {
			log(`Creating folder...`);
			await this.app.vault.createFolder(folderPath);
			log(`Folder created`);
		}
	}

	async handleFileCreated(file: TFile): Promise<void> {
		log(`handleFileCreated(${file.path}) called, syncInProgress=${this.syncInProgress}`);
		
		if (this.syncInProgress) {
			log(`Skipping handleFileCreated - sync in progress`);
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