import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-sync-service-'));
const outfile = join(tmp, 'sync-service-test.mjs');

const obsidianShim = {
	name: 'obsidian-shim',
	setup(build) {
		build.onResolve({filter: /^obsidian$/}, () => ({path: 'obsidian-shim', namespace: 'obsidian-shim'}));
		build.onLoad({filter: /.*/, namespace: 'obsidian-shim'}, () => ({
			loader: 'js',
			contents: `
				export class TAbstractFile {}
				export class TFile extends TAbstractFile {
					constructor(path) { super(); this.path = path; this.name = path.split('/').pop(); this.extension = 'md'; this.basename = this.name.replace(/\\.md$/, ''); this.stat = {mtime: 1}; }
				}
				export class TFolder extends TAbstractFile {
					constructor(path, children = []) { super(); this.path = path; this.name = path.split('/').pop(); this.children = children; }
				}
				export class Notice {
					constructor() { this.messageEl = {empty() {}, createSpan() {}, createEl() { return {addEventListener() {}}; }}; }
					hide() {}
				}
				export function parseYaml() { return {}; }
				export function stringifyYaml(value) { return JSON.stringify(value) + '\\n'; }
				export async function requestUrl() { throw new Error('Unexpected request'); }
			`,
		}));
	},
};

await esbuild.build({
	stdin: {
		contents: `
			import {TFile, TFolder} from 'obsidian';
			import {SyncService} from './src/sync.ts';
			globalThis.window = globalThis;

			const settings = {
				folderPath: 'LexiBridge', frontmatterTemplate: '', bodyTemplate: '', protectedHeadings: [],
				includeExamProperties: false, includePosProperties: false,
				syncCategoryIds: ['a', 'b'], defaultUploadCategoryId: 'a',
				syncDeletionProtection: true, syncMaxDeletionCount: 50,
			};

				function createApp(initialFiles = {}) {
					const nodes = new Map();
					const contents = new Map(Object.entries(initialFiles));
					const mutations = [];
				const root = new TFolder('LexiBridge', []);
				nodes.set('LexiBridge', root);
				function ensureFolder(path) {
					if (nodes.has(path)) return nodes.get(path);
					const folder = new TFolder(path, []);
					nodes.set(path, folder);
					const parent = nodes.get(path.split('/').slice(0, -1).join('/'));
					if (parent) parent.children.push(folder);
					return folder;
				}
				for (const [path] of contents) {
					const parentPath = path.split('/').slice(0, -1).join('/');
					const parent = ensureFolder(parentPath);
					const file = new TFile(path);
					nodes.set(path, file);
					parent.children.push(file);
				}
				return {
						nodes, contents, mutations,
						vault: {
						adapter: {exists: async path => nodes.has(path)},
						getAbstractFileByPath: path => nodes.get(path) || null,
							createFolder: async path => { mutations.push(['createFolder', path]); return ensureFolder(path); },
							create: async (path, content) => {
								mutations.push(['create', path]);
							const parent = ensureFolder(path.split('/').slice(0, -1).join('/'));
							const file = new TFile(path); nodes.set(path, file); contents.set(path, content); parent.children.push(file); return file;
						},
						read: async file => contents.get(file.path) || '',
							process: async (file, fn) => { mutations.push(['process', file.path]); contents.set(file.path, fn(contents.get(file.path) || '')); },
					},
					metadataCache: {getFileCache: file => ({frontmatter: {word: file.basename}})},
					fileManager: {
							renameFile: async (file, target) => { mutations.push(['rename', file.path, target]); nodes.delete(file.path); file.path = target; file.name = target.split('/').pop(); nodes.set(target, file); },
							trashFile: async file => { mutations.push(['trash', file.path]); nodes.delete(file.path); },
					},
				};
			}

			export async function run() {
				let stored = {};
				const app = createApp({'LexiBridge/Alpha/local.md': '# local'});
				const getWordsCalls = [];
				const service = new SyncService(app, settings, {
					getCategories: async () => [{id: 'a', name: 'Alpha'}, {id: 'b', name: 'Beta'}],
					getWords: async id => { getWordsCalls.push(id); return id === 'a' ? [{word: 'cloud', exp: 'n. cloud'}] : [{word: 'shared', exp: 'adj. shared'}]; },
				}, async () => stored, async data => { stored = data; });
					const dryRun = await service.dryRun();
					const dryRunMutations = [...app.mutations];
					const dryRunStored = structuredClone(stored);

					const migrationApp = createApp({
						'LexiBridge/Old/existing.md': '# existing',
						'LexiBridge/root.md': '# root',
					});
					let migrationStored = {syncManifest: {version: 2, lastSyncTime: 1, categories: {
						a: {name: 'Old', folderName: 'Old', syncedWords: ['existing', 'root']},
					}}};
					const migrationService = new SyncService(migrationApp, {...settings, syncCategoryIds: ['a']}, {
						getCategories: async () => [{id: 'a', name: 'New'}],
						getWords: async () => [{word: 'existing', exp: ''}, {word: 'root', exp: ''}],
						addWords: async () => {},
						deleteWords: async () => {},
					}, async () => migrationStored, async data => { migrationStored = data; });
					const migrationPlan = await migrationService.dryRun();
					const migrationDryRunMutations = [...migrationApp.mutations];
					const migrationDryRunStored = structuredClone(migrationStored);
					const migrationExecution = await migrationService.executeSync(
						migrationService.createAlignmentPlan(migrationPlan, 'preserve-both')
					);

				const reconciliationApp = createApp({'LexiBridge/Alpha/cloud-deleted.md': '# cloud deleted locally'});
				let reconciliationStored = {syncManifest: {version: 2, lastSyncTime: 1, categories: {
					a: {name: 'Alpha', folderName: 'Alpha', syncedWords: ['local-deleted', 'local-deleted-two', 'cloud-deleted']},
				}}};
				const reconciliationService = new SyncService(reconciliationApp, {
					...settings, syncCategoryIds: ['a'], syncMaxDeletionCount: 1,
				}, {
					getCategories: async () => [{id: 'a', name: 'Alpha'}],
					getWords: async () => [
						{word: 'local-deleted', exp: 'n. local deleted'},
						{word: 'local-deleted-two', exp: 'n. local deleted two'},
					],
				}, async () => reconciliationStored, async data => { reconciliationStored = data; });
				const reconciliationDryRun = await reconciliationService.dryRun();
				const preserveBothPlan = reconciliationService.createAlignmentPlan(reconciliationDryRun, 'preserve-both');
				const localWinsPlan = reconciliationService.createAlignmentPlan(reconciliationDryRun, 'local-wins');
				const cloudWinsPlan = reconciliationService.createAlignmentPlan(reconciliationDryRun, 'cloud-wins');

				const uploadApp = createApp();
				let uploadStored = {};
				const uploadBatches = [];
				const uploadService = new SyncService(uploadApp, {...settings, syncCategoryIds: ['a']}, {
					addWords: async (id, words) => uploadBatches.push([id, words.length]),
					deleteWords: async () => {},
				}, async () => uploadStored, async data => { uploadStored = data; });
				const uploadOps = Array.from({length: 101}, (_, index) => ({
					type: 'upload', categoryId: 'a', categoryName: 'Alpha', folderName: 'Alpha', word: 'word-' + index,
				}));
				const uploadResult = await uploadService.executeSync({
					localAdded: uploadOps.map(op => op.word), cloudAdded: [], localDeleted: [], cloudDeleted: [],
					errors: [], manifestMissing: false, operations: uploadOps,
				});

				const retryApp = createApp();
				let retryStored = {};
				const retryService = new SyncService(retryApp, {...settings, syncCategoryIds: ['a']}, {
					getCategories: async () => [{id: 'a', name: 'Alpha'}],
					getWords: async () => [{word: 'retryme', exp: 'n. retry'}],
				}, async () => retryStored, async data => { retryStored = data; });
				const retryPlan = await retryService.dryRun();
				retryApp.vault.create = async () => { throw new Error('disk full'); };
				const retryResult = await retryService.executeSync(retryPlan);

				const deletePath = 'LexiBridge/Alpha/deleted.md';
				const deleteApp = createApp({[deletePath]: '# preserved'});
				let deleteStored = {syncManifest: {version: 2, lastSyncTime: 1, categories: {a: {name: 'Alpha', folderName: 'Alpha', syncedWords: ['deleted']}}}};
				const deleteService = new SyncService(deleteApp, {...settings, syncCategoryIds: ['a']}, {}, async () => deleteStored, async data => { deleteStored = data; });
				const deleteFile = deleteApp.nodes.get(deletePath);
				await deleteService.handleFileModified(deleteFile);
				deleteApp.nodes.delete(deletePath);
				await deleteService.handleFileDeleted(deleteFile);
				const restored = await deleteService.undoLastDeletion();

				const renameApp = createApp();
				const alphaFolder = new TFolder('LexiBridge/Renamed', []);
				let renamedTo = null;
				let renameStored = {syncManifest: {version: 2, lastSyncTime: 1, categories: {a: {name: 'Alpha', folderName: 'Alpha', syncedWords: []}}}};
				const renameService = new SyncService(renameApp, {...settings, syncCategoryIds: ['a']}, {
					renameCategory: async (id, name) => { renamedTo = [id, name]; },
				}, async () => renameStored, async data => { renameStored = data; });
				await renameService.handleFileRenamed(alphaFolder, 'LexiBridge/Alpha');

					const generatedSyncMarkdown = uploadService['generateMarkdown']('dec', 'n. dec', ['Alpha']);

					const unknownApp = createApp({'LexiBridge/Alpha/late.md': '# late'});
					let unknownStored = {syncManifest: {version: 2, lastSyncTime: 1, categories: {
						a: {name: 'Alpha', folderName: 'Alpha', syncedWords: []},
					}}};
					const remoteWords = new Set();
					let unknownAddCalls = 0;
					const unknownService = new SyncService(unknownApp, {...settings, syncCategoryIds: ['a']}, {
						getCategories: async () => [{id: 'a', name: 'Alpha'}],
						getWords: async () => [...remoteWords].map(word => ({word, exp: ''})),
						addWords: async (_id, words) => new Promise(resolve => setTimeout(() => {
							unknownAddCalls += 1;
							for (const word of words) remoteWords.add(word);
							resolve('ok');
						}, 20)),
						deleteWords: async () => {},
					}, async () => unknownStored, async data => { unknownStored = data; }, 1);
					const unknownPlan = await unknownService.dryRun();
					const unknownResult = await unknownService.executeSync(unknownPlan);
					await new Promise(resolve => setTimeout(resolve, 30));
					const recoveryPlan = await unknownService.dryRun();

					return {dryRun, dryRunMutations, dryRunStored, migrationPlan, migrationDryRunMutations, migrationDryRunStored, migrationExecution, migrationMutations: migrationApp.mutations, migrationStored, reconciliationDryRun, preserveBothPlan, localWinsPlan, cloudWinsPlan, getWordsCalls, folders: [...app.nodes.keys()], uploadBatches, uploadResult, retryResult, retryStored, restored, restoredContent: deleteApp.contents.get(deletePath), renamedTo, renameStored, generatedSyncMarkdown, unknownResult, unknownAddCalls, unknownStored, recoveryPlan};
			}
		`,
		resolveDir: process.cwd(), sourcefile: 'sync-service-test.ts', loader: 'ts',
	},
	bundle: true, format: 'esm', platform: 'node', outfile, plugins: [obsidianShim],
});

const {run} = await import(pathToFileURL(outfile).href);
const result = await run();

assert.deepEqual(result.getWordsCalls.sort(), ['a', 'b']);
assert.ok(result.folders.includes('LexiBridge/Alpha'));
assert.ok(!result.folders.includes('LexiBridge/Beta'), 'dryRun must not create category folders');
assert.deepEqual(result.dryRunMutations, [], 'dryRun and user cancellation must not mutate the Vault');
assert.deepEqual(result.dryRunStored, {}, 'dryRun and user cancellation must not write the manifest');
assert.ok(result.dryRun.localPreparations.some(item => item.type === 'create_folder' && item.targetPath === 'LexiBridge/Beta'));
assert.deepEqual(result.migrationDryRunMutations, []);
assert.deepEqual(result.migrationDryRunStored.syncManifest.categories.a.folderName, 'Old');
assert.ok(result.migrationPlan.localPreparations.some(item =>
	item.type === 'rename_folder' && item.sourcePath === 'LexiBridge/Old' && item.targetPath === 'LexiBridge/New'));
assert.ok(result.migrationPlan.localPreparations.some(item =>
	item.type === 'move_file' && item.sourcePath === 'LexiBridge/root.md' && item.targetPath === 'LexiBridge/New/root.md'));
assert.equal(result.migrationExecution.success, true);
assert.ok(result.migrationMutations.some(item => item[0] === 'rename' && item[1] === 'LexiBridge/Old'));
assert.ok(result.migrationMutations.some(item => item[0] === 'rename' && item[1] === 'LexiBridge/root.md'));
assert.equal(result.migrationStored.syncManifest.categories.a.folderName, 'New');
assert.ok(result.dryRun.operations.some(op => op.type === 'upload' && op.categoryId === 'a' && op.word === 'local'));
assert.ok(result.dryRun.operations.some(op => op.type === 'download' && op.categoryId === 'a' && op.word === 'cloud'));
assert.ok(result.dryRun.operations.some(op => op.type === 'download' && op.categoryId === 'b' && op.word === 'shared'));
assert.equal(result.dryRun.requiresAlignment, true);
assert.ok(result.dryRun.alignmentReasons.includes('missing-baseline'));
assert.equal(result.reconciliationDryRun.requiresAlignment, true);
assert.deepEqual(result.reconciliationDryRun.alignmentReasons, ['local-missing', 'cloud-missing']);
assert.ok(result.reconciliationDryRun.differences.some(item => item.type === 'localDeleted' && item.path === 'LexiBridge/Alpha/local-deleted.md'));
assert.ok(result.reconciliationDryRun.differences.some(item => item.type === 'localDeleted' && item.path === 'LexiBridge/Alpha/local-deleted-two.md'));
assert.ok(result.reconciliationDryRun.differences.some(item => item.type === 'cloudDeleted' && item.path === 'LexiBridge/Alpha/cloud-deleted.md'));
assert.deepEqual(result.preserveBothPlan.operations.map(item => [item.type, item.word]).sort(), [
	['download', 'local-deleted'],
	['download', 'local-deleted-two'],
	['upload', 'cloud-deleted'],
]);
assert.deepEqual(result.cloudWinsPlan.operations.map(item => [item.type, item.word]).sort(), [
	['download', 'local-deleted'],
	['download', 'local-deleted-two'],
	['trash_local', 'cloud-deleted'],
]);
assert.deepEqual(result.localWinsPlan.operations.map(item => [item.type, item.word]).sort(), [
	['delete_cloud', 'local-deleted'],
	['delete_cloud', 'local-deleted-two'],
	['upload', 'cloud-deleted'],
]);
assert.match(result.localWinsPlan.errors[0], /计划删除 2 个词条/);
assert.equal(result.uploadResult.success, true);
assert.deepEqual(result.uploadBatches, [['a', 100], ['a', 1]]);
assert.equal(result.retryResult.success, false);
assert.ok(!result.retryStored.syncManifest.categories.a.syncedWords.includes('retryme'), 'failed download must remain retryable');
assert.equal(result.restored, true);
assert.equal(result.restoredContent, '# preserved');
assert.deepEqual(result.renamedTo, ['a', 'Renamed']);
assert.equal(result.renameStored.syncManifest.categories.a.name, 'Renamed');
assert.ok(!result.generatedSyncMarkdown.includes('[!info] 欧路同步'));
assert.ok(!result.generatedSyncMarkdown.includes('obsidian://lexibridge'));
assert.equal(result.unknownResult.success, false);
assert.match(result.unknownResult.errors[0], /结果未知/);
assert.equal(result.unknownAddCalls, 1, 'unknown remote write must not be automatically retried');
assert.ok(!result.unknownStored.syncManifest.categories.a.syncedWords.includes('late'), 'unknown result must not update manifest');
assert.equal(result.recoveryPlan.operations.filter(item => item.type === 'upload' && item.word === 'late').length, 0, 'late remote success must reconcile without duplicate upload');
assert.equal(result.recoveryPlan.manifestNeedsRefresh, true);

console.log('Sync service tests passed');
