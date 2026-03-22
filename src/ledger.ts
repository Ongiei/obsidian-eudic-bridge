import { App, TFile, TFolder } from 'obsidian';

export interface LedgerEntry {
	word: string;
	eudicId: string;
	lastSyncTime: number;
	status: 'active' | 'deleted' | 'cloud-deleted';
	localFile: boolean;
	cloudExists: boolean;
	createdAt: number;
}

export interface SyncLedger {
	version: number;
	entries: Record<string, LedgerEntry>;
}

export const LEDGER_VERSION = 1;
export const LEDGER_KEY = 'syncLedger';

export class LedgerService {
	private app: App;
	private ledger: SyncLedger;
	private pluginData: { loadData: () => Promise<unknown>; saveData: (data: unknown) => Promise<void> };

	constructor(
		app: App,
		pluginData: { loadData: () => Promise<unknown>; saveData: (data: unknown) => Promise<void> }
	) {
		this.app = app;
		this.pluginData = pluginData;
		this.ledger = { version: LEDGER_VERSION, entries: {} };
	}

	async load(): Promise<void> {
		const data = await this.pluginData.loadData();
		if (data && typeof data === 'object' && LEDGER_KEY in data) {
			const savedLedger = (data as Record<string, unknown>)[LEDGER_KEY] as SyncLedger;
			if (savedLedger && savedLedger.version === LEDGER_VERSION) {
				this.ledger = savedLedger;
			} else {
				this.ledger = this.migrateLedger(savedLedger);
			}
		}
	}

	async save(): Promise<void> {
		const data = await this.pluginData.loadData() as Record<string, unknown> ?? {};
		data[LEDGER_KEY] = this.ledger;
		await this.pluginData.saveData(data);
	}

	private migrateLedger(oldLedger: SyncLedger | undefined): SyncLedger {
		if (!oldLedger) {
			return { version: LEDGER_VERSION, entries: {} };
		}
		return { version: LEDGER_VERSION, entries: oldLedger.entries || {} };
	}

	getEntry(word: string): LedgerEntry | undefined {
		return this.ledger.entries[word.toLowerCase()];
	}

	setEntry(word: string, entry: Partial<LedgerEntry>): void {
		const key = word.toLowerCase();
		const existing = this.ledger.entries[key];
		this.ledger.entries[key] = {
			word: entry.word ?? existing?.word ?? word,
			eudicId: entry.eudicId ?? existing?.eudicId ?? '',
			lastSyncTime: entry.lastSyncTime ?? existing?.lastSyncTime ?? Date.now(),
			status: entry.status ?? existing?.status ?? 'active',
			localFile: entry.localFile ?? existing?.localFile ?? false,
			cloudExists: entry.cloudExists ?? existing?.cloudExists ?? false,
			createdAt: entry.createdAt ?? existing?.createdAt ?? Date.now(),
		};
	}

	deleteEntry(word: string): void {
		delete this.ledger.entries[word.toLowerCase()];
	}

	markDeleted(word: string): void {
		const key = word.toLowerCase();
		if (this.ledger.entries[key]) {
			this.ledger.entries[key].status = 'deleted';
			this.ledger.entries[key].lastSyncTime = Date.now();
		}
	}

	markActive(word: string, eudicId?: string): void {
		const key = word.toLowerCase();
		const existing = this.ledger.entries[key];
		this.ledger.entries[key] = {
			word: existing?.word ?? word,
			eudicId: eudicId ?? existing?.eudicId ?? '',
			lastSyncTime: Date.now(),
			status: 'active',
			localFile: true,
			cloudExists: true,
			createdAt: existing?.createdAt ?? Date.now(),
		};
	}

	getAllEntries(): LedgerEntry[] {
		return Object.values(this.ledger.entries);
	}

	getActiveEntries(): LedgerEntry[] {
		return this.getAllEntries().filter(e => e.status === 'active');
	}

	getDeletedEntries(): LedgerEntry[] {
		return this.getAllEntries().filter(e => e.status === 'deleted');
	}

	getLocalOnlyWords(): string[] {
		return this.getAllEntries()
			.filter(e => e.status === 'active' && e.localFile && !e.cloudExists)
			.map(e => e.word);
	}

	getCloudOnlyWords(): string[] {
		return this.getAllEntries()
			.filter(e => e.status === 'active' && !e.localFile && e.cloudExists)
			.map(e => e.word);
	}

	syncLocalFiles(folderPath: string): void {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return;

		const localWords = new Set<string>();
		for (const file of folder.children) {
			if (file instanceof TFile && file.extension === 'md') {
				const word = file.basename.toLowerCase();
				localWords.add(word);
				
				if (!this.ledger.entries[word]) {
					this.setEntry(word, {
						word: file.basename,
						status: 'active',
						localFile: true,
						cloudExists: false,
					});
				} else {
					this.ledger.entries[word].localFile = true;
				}
			}
		}

		for (const entry of this.getAllEntries()) {
			if (!localWords.has(entry.word.toLowerCase()) && entry.localFile) {
				entry.localFile = false;
				if (entry.status === 'active') {
					entry.status = 'deleted';
					entry.lastSyncTime = Date.now();
				}
			}
		}
	}

	syncCloudWords(cloudWords: { word: string; id?: string }[]): void {
		const cloudSet = new Set<string>();
		for (const cw of cloudWords) {
			const key = cw.word.toLowerCase();
			cloudSet.add(key);

			if (!this.ledger.entries[key]) {
				this.setEntry(cw.word, {
					eudicId: cw.id ?? '',
					status: 'active',
					localFile: false,
					cloudExists: true,
				});
			} else {
				this.ledger.entries[key].cloudExists = true;
				if (cw.id) {
					this.ledger.entries[key].eudicId = cw.id;
				}
			}
		}

		for (const entry of this.getAllEntries()) {
			if (!cloudSet.has(entry.word.toLowerCase()) && entry.cloudExists && entry.status === 'active') {
				entry.cloudExists = false;
				if (entry.localFile) {
					entry.status = 'cloud-deleted';
					entry.lastSyncTime = Date.now();
				}
			}
		}
	}

	getEntriesNeedingSync(): { toUpload: string[]; toDownload: string[]; toDeleteFromCloud: string[]; cloudDeleted: string[] } {
		const result = {
			toUpload: [] as string[],
			toDownload: [] as string[],
			toDeleteFromCloud: [] as string[],
			cloudDeleted: [] as string[],
		};

		for (const entry of this.getAllEntries()) {
			const key = entry.word.toLowerCase();

			if (entry.status === 'deleted' && entry.cloudExists) {
				result.toDeleteFromCloud.push(key);
			} else if (entry.status === 'cloud-deleted') {
				result.cloudDeleted.push(key);
			} else if (entry.status === 'active') {
				if (entry.localFile && !entry.cloudExists) {
					result.toUpload.push(key);
				} else if (!entry.localFile && entry.cloudExists) {
					result.toDownload.push(key);
				}
			}
		}

		return result;
	}

	export(): SyncLedger {
		return JSON.parse(JSON.stringify(this.ledger)) as SyncLedger;
	}

	import(ledger: SyncLedger): void {
		this.ledger = ledger;
	}

	clear(): void {
		this.ledger = { version: LEDGER_VERSION, entries: {} };
	}
}