import { App, TFile, TFolder, stringifyYaml } from 'obsidian';
import { EudicService } from './eudic';
import { LinkDictSettings } from './settings';
import { t } from './i18n';

export type DictSource = 'eudic' | 'youdao';

export interface SyncChange {
	word: string;
	action: 'download' | 'upload' | 'delete_local' | 'delete_from_cloud';
	reason: string;
}

export interface SyncDryRunResult {
	toDownload: SyncChange[];
	toUpload: SyncChange[];
	toDeleteLocal: SyncChange[];
	toDeleteFromCloud: SyncChange[];
	errors: string[];
}

export interface SyncResult {
	success: boolean;
	uploaded: number;
	downloaded: number;
	deletedFromCloud: number;
	deletedLocal: number;
	skipped: number;
	errors: string[];
}

export interface Frontmatter {
	tags?: string[];
	aliases?: string[];
	dict_source?: DictSource;
	[key: string]: unknown;
}

export interface EudicWordData {
	word: string;
	exp?: string;
}

export interface SyncManifest {
	lastSyncTime: string;
	syncedWords: string[];
}

export interface ExternalChanges {
	possiblyDeletedLocally: string[];
	possiblyAddedLocally: string[];
}

export interface ExternalChangesResolution {
	deletedAction: 'delete_from_cloud' | 'redownload' | 'ignore';
	addedAction: 'upload' | 'delete_local' | 'ignore';
}

const DEFAULT_API_DELAY_MS = 200;
const API_TIMEOUT_MS = 30000;
const FILE_TIMEOUT_MS = 10000;
const MANIFEST_KEY = 'syncManifest';

// 跟踪插件主动删除的单词（用于区分外部删除）
const pluginDeletedWords = new Set<string>();

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				reject(new Error(`Timeout after ${ms}ms: ${operation}`));
			}
		}, ms);
		
		promise
			.then(result => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(result);
				}
			})
			.catch(err => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(err);
				}
			});
	});
}

export class SyncService {
	private app: App;
	private settings: LinkDictSettings;
	private eudicService: EudicService;
	private saveSettings: () => Promise<void>;
	private loadData: () => Promise<unknown>;
	private saveData: (data: unknown) => Promise<void>;
	private isSyncing = false;
	private shouldAbort = false;
	private cachedRemoteData: Map<string, EudicWordData> | null = null;

	constructor(
		app: App,
		settings: LinkDictSettings,
		eudicService: EudicService,
		saveSettings: () => Promise<void>,
		loadData: () => Promise<unknown> = () => Promise.resolve({}),
		saveData: (data: unknown) => Promise<void> = () => Promise.resolve()
	) {
		this.app = app;
		this.settings = settings;
		this.eudicService = eudicService;
		this.saveSettings = saveSettings;
		this.loadData = loadData;
		this.saveData = saveData;
	}

	isSyncInProgress(): boolean {
		return this.isSyncing;
	}

	abort(): void {
		this.shouldAbort = true;
	}

	private async loadManifest(): Promise<SyncManifest | null> {
		try {
			const data = await this.loadData();
			if (data && typeof data === 'object' && MANIFEST_KEY in data) {
				return (data as Record<string, unknown>)[MANIFEST_KEY] as SyncManifest;
			}
		} catch {
			// Ignore errors
		}
		return null;
	}

	private async saveManifest(words: string[]): Promise<void> {
		const manifest: SyncManifest = {
			lastSyncTime: new Date().toISOString(),
			syncedWords: words,
		};
		
		try {
			const data = (await this.loadData()) as Record<string, unknown> || {};
			data[MANIFEST_KEY] = manifest;
			await this.saveData(data);
		} catch (error) {
			console.error('[LinkDict] Failed to save manifest:', error);
		}
	}

	/**
	 * 从 manifest 中移除单词（当插件主动删除文件时调用）
	 */
	private async removeWordFromManifest(word: string): Promise<void> {
		const manifest = await this.loadManifest();
		if (manifest) {
			manifest.syncedWords = manifest.syncedWords.filter(w => w.toLowerCase() !== word.toLowerCase());
			await this.saveManifest(manifest.syncedWords);
		}
	}

	/**
	 * 检测外部变动（插件不在场时的文件增删）
	 * 只检测那些不在 pluginDeletedWords 集合中的删除
	 */
	async detectExternalChanges(): Promise<ExternalChanges | null> {
		// Clear any stale cache before starting
		this.cachedRemoteData = null;
		
		const manifest = await this.loadManifest();
		
		// 首次同步，没有 manifest，不检测外部变动
		if (!manifest || manifest.syncedWords.length === 0) {
			return null;
		}

		// 获取云端数据
		if (!this.cachedRemoteData) {
			this.cachedRemoteData = await this.fetchRemoteWordData();
		}
		
		const localWords = await this.fetchLocalWords();
		
		const cloudWords = new Set(this.cachedRemoteData.keys());
		const manifestWords = new Set(manifest.syncedWords.map(w => w.toLowerCase()));
		const localSet = new Set(localWords.map(w => w.toLowerCase()));

		// possiblyDeletedLocally = manifestWords ∩ cloudWords - localWords - pluginDeletedWords
		// (manifest 有、云端有、本地不见了，且不是插件主动删除的)
		const possiblyDeletedLocally: string[] = [];
		for (const word of manifestWords) {
			if (cloudWords.has(word) && !localSet.has(word) && !pluginDeletedWords.has(word)) {
				possiblyDeletedLocally.push(word);
			}
		}

		// possiblyAddedLocally = localWords - manifestWords - cloudWords
		// (本地有、但 manifest 和云端都没有记录)
		const possiblyAddedLocally: string[] = [];
		for (const word of localSet) {
			if (!manifestWords.has(word) && !cloudWords.has(word)) {
				possiblyAddedLocally.push(word);
			}
		}

		// 清理 pluginDeletedWords（已经处理过的）
		pluginDeletedWords.clear();

		if (possiblyDeletedLocally.length === 0 && possiblyAddedLocally.length === 0) {
			return null;
		}

		return { possiblyDeletedLocally, possiblyAddedLocally };
	}

	/**
	 * 计算同步差异（核心逻辑）
	 */
	async dryRun(resolution?: ExternalChangesResolution): Promise<SyncDryRunResult> {
		const result: SyncDryRunResult = {
			toDownload: [],
			toUpload: [],
			toDeleteLocal: [],
			toDeleteFromCloud: [],
			errors: [],
		};

		try {
			// 获取云端数据
			if (!this.cachedRemoteData) {
				this.cachedRemoteData = await this.fetchRemoteWordData();
			}
			
			const manifest = await this.loadManifest();
			const localWords = await this.fetchLocalWords();

			const cloudWords = new Set(this.cachedRemoteData.keys());
			const localSet = new Set(localWords.map(w => w.toLowerCase()));
			const manifestWords = manifest 
				? new Set(manifest.syncedWords.map(w => w.toLowerCase()))
				: new Set<string>();

			const processedWords = new Set<string>();

			// ===== 处理外部变动（用户决策）=====
			if (resolution) {
				// 处理外部删除
				if (resolution.deletedAction === 'delete_from_cloud') {
					for (const word of manifestWords) {
						if (cloudWords.has(word) && !localSet.has(word) && !processedWords.has(word)) {
							result.toDeleteFromCloud.push({
								word,
								action: 'delete_from_cloud',
								reason: t('sync_reason_local_deleted'),
							});
							processedWords.add(word);
						}
					}
				} else if (resolution.deletedAction === 'redownload') {
					for (const word of manifestWords) {
						if (cloudWords.has(word) && !localSet.has(word) && !processedWords.has(word)) {
							result.toDownload.push({
								word,
								action: 'download',
								reason: t('sync_reason_remote_only'),
							});
							processedWords.add(word);
						}
					}
				}

				// 处理外部新增
				if (resolution.addedAction === 'upload') {
					for (const word of localSet) {
						if (!manifestWords.has(word) && !cloudWords.has(word) && !processedWords.has(word)) {
							result.toUpload.push({
								word,
								action: 'upload',
								reason: t('sync_reason_local_new'),
							});
							processedWords.add(word);
						}
					}
				} else if (resolution.addedAction === 'delete_local') {
					for (const word of localSet) {
						if (!manifestWords.has(word) && !cloudWords.has(word) && !processedWords.has(word)) {
							result.toDeleteLocal.push({
								word,
								action: 'delete_local',
								reason: t('sync_reason_unknown_file'),
							});
							processedWords.add(word);
						}
					}
				}
			}

			// ===== 正常同步逻辑（四阶段）=====
			
			// 1. 欧路新增（云端有，本地无）→ 下载到本地
			// 不管 manifest，只要云端有、本地没有就下载
			for (const word of cloudWords) {
				if (!localSet.has(word) && !processedWords.has(word)) {
					result.toDownload.push({
						word,
						action: 'download',
						reason: t('sync_reason_remote_only'),
					});
					processedWords.add(word);
				}
			}

			// 2. 欧路删除（manifest 有，云端无，本地有）→ 删除本地文件
			for (const word of manifestWords) {
				if (!cloudWords.has(word) && localSet.has(word) && !processedWords.has(word)) {
					result.toDeleteLocal.push({
						word,
						action: 'delete_local',
						reason: t('sync_reason_cloud_deleted'),
					});
					processedWords.add(word);
				}
			}

			// 3. 本地新增（本地有，云端无）→ 上传到欧路
			// 不管 manifest，只要本地有、云端没有就上传
			for (const word of localSet) {
				if (!cloudWords.has(word) && !processedWords.has(word)) {
					result.toUpload.push({
						word,
						action: 'upload',
						reason: t('sync_reason_local_new'),
					});
					processedWords.add(word);
				}
			}

			// 4. 本地删除（manifest 有，本地无，云端有）→ 删除云端
			// 只有之前同步过的单词（在 manifest 中）才删除云端
			for (const word of manifestWords) {
				if (!localSet.has(word) && cloudWords.has(word) && !processedWords.has(word)) {
					result.toDeleteFromCloud.push({
						word,
						action: 'delete_from_cloud',
						reason: t('sync_reason_local_deleted'),
					});
					processedWords.add(word);
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
				deletedLocal: 0,
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
			deletedLocal: 0,
			skipped: 0,
			errors: [...dryRunResult.errors],
		};

		const totalOps = dryRunResult.toDeleteFromCloud.length + 
			dryRunResult.toDownload.length + 
			dryRunResult.toUpload.length + 
			dryRunResult.toDeleteLocal.length;

		let current = 0;
		const delayMs = this.settings.apiDelayMs || DEFAULT_API_DELAY_MS;

		try {
			// Phase 1: 删除云端（本地删除的单词）
			current = await this.processPhase(
				dryRunResult.toDeleteFromCloud,
				'delete_from_cloud',
				current, totalOps,
				result,
				progressCallback,
				async (change) => {
					const listId = this.settings.eudicDefaultListId || '0';
					await withTimeout(
						this.eudicService.deleteWords(listId, [change.word]),
						API_TIMEOUT_MS,
						`deleteWords(${change.word})`
					);
					result.deletedFromCloud++;
				},
				delayMs
			);

			// Phase 2: 下载（欧路新增的单词）
			const remoteData = this.cachedRemoteData || new Map();
			current = await this.processPhase(
				dryRunResult.toDownload,
				'download',
				current, totalOps,
				result,
				progressCallback,
				async (change) => {
					await this.downloadWord(change.word, remoteData.get(change.word)?.exp, result);
				},
				delayMs
			);

			// Phase 3: 上传（本地新增的单词）
			current = await this.processPhase(
				dryRunResult.toUpload,
				'upload',
				current, totalOps,
				result,
				progressCallback,
				async (change) => {
					await this.uploadWord(change.word, result);
				},
				delayMs
			);

			// Phase 4: 删除本地（欧路删除的单词）
			await this.processPhase(
				dryRunResult.toDeleteLocal,
				'delete_local',
				current, totalOps,
				result,
				progressCallback,
				async (change) => {
					await this.deleteLocalWord(change.word, result);
				},
				delayMs
			);

			result.success = !this.shouldAbort && result.errors.length === dryRunResult.errors.length;
			
			// 同步成功后保存 manifest
			if (result.success) {
				const finalCloudWords = await this.fetchRemoteWordData();
				await this.saveManifest(Array.from(finalCloudWords.keys()));
			}
			
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(`Fatal error: ${errorMsg}`);
		} finally {
			this.isSyncing = false;
			this.cachedRemoteData = null;
		}

		return result;
	}

	private async processPhase(
		changes: SyncChange[],
		phaseName: string,
		startIndex: number,
		totalOps: number,
		result: SyncResult,
		progressCallback: ((current: number, total: number, word: string) => void) | undefined,
		operation: (change: SyncChange) => Promise<void>,
		delayMs: number
	): Promise<number> {
		let current = startIndex;
		
		for (const change of changes) {
			if (this.shouldAbort) break;
			
			current++;
			progressCallback?.(current, totalOps, change.word);
			
			try {
				await operation(change);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				result.errors.push(`${phaseName} "${change.word}" failed: ${errorMsg}`);
			}
			
			await delay(delayMs);
		}
		
		return current;
	}

	private async fetchRemoteWordData(): Promise<Map<string, EudicWordData>> {
		const data = new Map<string, EudicWordData>();
		const listId = this.settings.eudicDefaultListId || '0';
		const pageSize = 100;
		let page = 1;

		while (true) {
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
		}

		return data;
	}

	private async fetchLocalWords(): Promise<string[]> {
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!(folder instanceof TFolder)) {
			return [];
		}

		return folder.children
			.filter((child): child is TFile => child instanceof TFile && child.extension === 'md')
			.map(file => file.basename.toLowerCase());
	}

	private async downloadWord(word: string, eudicExp: string | undefined, result: SyncResult): Promise<void> {
		const folderPath = this.settings.folderPath;
		const filePath = `${folderPath}/${word}.md`;

		if (await this.app.vault.adapter.exists(filePath)) {
			result.skipped++;
			return;
		}

		await this.ensureFolderExists(folderPath);

		const frontmatter: Frontmatter = {
			tags: ['vocabulary'],
			dict_source: 'eudic',
		};

		let content = `---\n${stringifyYaml(frontmatter)}---\n\n`;
		content += `# ${word}\n\n`;
		content += `## ${t('view_definitions')}\n\n`;
		content += eudicExp ? `- ${eudicExp}\n\n` : `*Definition pending update*\n\n`;
		content += `> [!info] Eudic Sync\n`;
		content += `> [🔄 ${t('sync_clickToUpdate')}](obsidian://linkdict?action=update&word=${encodeURIComponent(word)})\n`;

		await withTimeout(
			this.app.vault.create(filePath, content),
			FILE_TIMEOUT_MS,
			`vault.create(${word})`
		);
		result.downloaded++;
	}

	private async uploadWord(word: string, result: SyncResult): Promise<void> {
		const listId = this.settings.eudicDefaultListId || '0';
		
		await withTimeout(
			this.eudicService.addWords(listId, [word]),
			API_TIMEOUT_MS,
			`addWords(${word})`
		);

		result.uploaded++;
	}

	private async deleteLocalWord(word: string, result: SyncResult): Promise<void> {
		const filePath = `${this.settings.folderPath}/${word}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			await this.app.vault.delete(file);
			result.deletedLocal++;
		} else {
			result.skipped++;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (!await this.app.vault.adapter.exists(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	/**
	 * 处理文件创建事件
	 * 如果启用了 autoAddToEudic，立即上传到云端
	 */
	async handleFileCreated(file: TFile): Promise<void> {
		if (this.isSyncing) return;
		if (file.extension !== 'md') return;
		if (!file.path.startsWith(this.settings.folderPath)) return;

		const word = file.basename;
		if (!word || !/^[a-zA-Z]+(-[a-zA-Z]+)*$/.test(word)) return;
		if (!this.settings.autoAddToEudic) return;

		try {
			const listId = this.settings.eudicDefaultListId || '0';
			await withTimeout(
				this.eudicService.addWords(listId, [word]),
				API_TIMEOUT_MS,
				`addWords(${word})`
			);
			console.log(`[LinkDict] Auto-uploaded "${word}" to cloud`);
		} catch (error) {
			console.error(`[LinkDict] Failed to auto-upload "${word}":`, error);
		}
	}

	/**
	 * 处理文件删除事件
	 * 如果启用了同步，立即从云端删除
	 */
	async handleFileDeleted(file: TFile): Promise<void> {
		if (this.isSyncing) return;
		if (file.extension !== 'md') return;
		if (!file.path.startsWith(this.settings.folderPath)) return;

		const word = file.basename.toLowerCase();
		if (!word) return;

		// 标记为插件主动删除（用于区分外部删除）
		pluginDeletedWords.add(word);

		// 无论云端删除是否成功，都要从 manifest 中移除
		// 因为本地文件已被删除，manifest 不应再包含它
		await this.removeWordFromManifest(word);

		// 如果启用了同步，尝试从云端删除
		if (this.settings.enableSync) {
			try {
				const listId = this.settings.eudicDefaultListId || '0';
				await withTimeout(
					this.eudicService.deleteWords(listId, [word]),
					API_TIMEOUT_MS,
					`deleteWords(${word})`
				);
				console.log(`[LinkDict] Auto-deleted "${word}" from cloud`);
			} catch (error) {
				// 单词可能已在云端不存在，忽略错误
				console.log(`[LinkDict] Note: "${word}" may not exist in cloud`);
			}
		}
	}
}