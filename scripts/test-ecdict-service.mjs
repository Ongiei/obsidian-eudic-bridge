import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { indexedDB } from 'fake-indexeddb';
import { Buffer } from 'node:buffer';
import {createHash} from 'node:crypto';

globalThis.indexedDB = indexedDB;
globalThis.window = globalThis;
const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-ecdict-service-'));
const outfile = join(tmp, 'ecdict-service.mjs');
const obsidianShim = {
	name: 'obsidian-shim',
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-shim', namespace: 'obsidian-shim' }));
		build.onLoad({ filter: /.*/, namespace: 'obsidian-shim' }, () => ({
			loader: 'js',
				contents: 'export const Platform = {isMobileApp: false}; export async function requestUrl() { throw new Error("Unexpected request"); }',
		}));
	},
};

await esbuild.build({
	stdin: {
		contents: `export { EcdictManager } from './src/ecdict.ts'; export { EcdictDatabase } from './src/ecdict-database.ts';`,
		resolveDir: process.cwd(), sourcefile: 'ecdict-service-test.ts', loader: 'ts',
	},
	bundle: true, format: 'esm', platform: 'node', outfile, plugins: [obsidianShim],
});

const { EcdictDatabase, EcdictManager } = await import(pathToFileURL(outfile).href);
const header = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n';
const validPackage = header
	+ 'the,ðə,,art. 这；那,,,,zk,,,s:thes,,\n'
	+ 'hello,həˈləʊ,,int. 你好,,,,cet4,,,s:hellos,,\n'
	+ 'NASA,,n. 美国国家航空航天局,,,,,,,,\n';
const invalidPackage = header + 'the,ðə,,art. 这；那,,,,zk,,,,,\n';
let sha = 'a'.repeat(40);
let packageText = validPackage;

function gitBlobSha(text) {
	const bytes = Buffer.from(text);
	return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
let expectedBlobSha = gitBlobSha(packageText);

const request = async options => {
	if (options.url.includes('/commits?')) {
		return {
			status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), text: '',
			json: [{ sha }],
		};
	}
	if (options.url.includes('/contents/ecdict.csv')) {
		return {
			status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), text: '',
			json: {sha: expectedBlobSha},
		};
	}
	const packageBytes = Buffer.from(packageText);
	return {
		status: 200, headers: {},
		arrayBuffer: packageBytes.buffer.slice(packageBytes.byteOffset, packageBytes.byteOffset + packageBytes.byteLength),
		text: '', json: {},
	};
};

const database = new EcdictDatabase();
const manager = new EcdictManager(database, request, 3, 1);
const progress = [];
const installation = await manager.install('jsdelivr', item => progress.push(item));
assert.equal(installation.entryCount, 3);
assert.equal((await manager.getStatus()).valid, true);
assert.equal((await database.lookup('HELLO')).definitions[0].trans, '你好');
assert.equal((await database.lookup('nasa')).word, 'NASA');
assert.equal((await manager.checkForUpdate('jsdelivr')).available, false);
assert.equal(progress.at(-1).progress, 1);

sha = 'b'.repeat(40);
packageText = invalidPackage;
expectedBlobSha = gitBlobSha(packageText);
await assert.rejects(() => manager.install('jsdelivr', undefined, { aborted: false }), /词条数量异常/);
assert.equal((await database.lookup('hello')).word, 'hello', 'failed update must preserve active dictionary');
assert.equal((await manager.checkForUpdate('jsdelivr')).available, true);

packageText = validPackage.replace('你好', '你坏');
expectedBlobSha = gitBlobSha(validPackage);
await assert.rejects(() => manager.install('jsdelivr'), /完整性校验失败/);
assert.equal((await database.lookup('hello')).word, 'hello', 'tampered package must preserve active dictionary');

const mobileManager = new EcdictManager(database, request, 3, 1, true);
await assert.rejects(() => mobileManager.install('github'), /移动端暂不支持直接安装/);
assert.equal((await database.lookup('hello')).word, 'hello', 'mobile refusal must preserve active dictionary');

await manager.remove();
assert.equal((await manager.getStatus()).installed, false);

console.log('ECDICT service tests passed');
