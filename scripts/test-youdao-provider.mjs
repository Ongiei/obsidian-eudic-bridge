import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-youdao-provider-'));
const outfile = join(tmp, 'youdao-provider.mjs');
const obsidianShim = {
	name: 'obsidian-shim',
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-shim', namespace: 'obsidian-shim' }));
		build.onLoad({ filter: /.*/, namespace: 'obsidian-shim' }, () => ({
			loader: 'js', contents: 'export async function requestUrl() { throw new Error("Unexpected request"); }',
		}));
	},
};
await esbuild.build({
	stdin: {
		contents: `export { YoudaoProvider } from './src/youdao-provider.ts'; export { parseYoudaoResponse, YoudaoRequestError } from './src/youdao.ts';`,
		resolveDir: process.cwd(), sourcefile: 'youdao-provider-test.ts', loader: 'ts',
	},
	bundle: true, format: 'esm', platform: 'node', outfile, plugins: [obsidianShim],
});
const { parseYoudaoResponse, YoudaoProvider, YoudaoRequestError } = await import(pathToFileURL(outfile).href);

const currentResponseShape = parseYoudaoResponse({
	ec: {
		word: [{
			'return-phrase': {l: {i: 'word'}},
			ukphone: 'wɜːd',
			usphone: 'wɜːrd',
			ukspeech: 'word&type=1',
			usspeech: 'word&type=2',
			trs: [{tr: [{l: {i: ['n. 字，词，单词']}}]}],
			wfs: [{wf: {name: '复数', value: 'words'}}],
		}],
		exam_type: ['初中', 'CET4'],
	},
	web_trans: {
		'web-translation': [{
			'@key': null,
			key: {l: {i: 'Word'}},
			trans: [{value: '字'}, {value: '单词'}, {value: '字'}],
		}],
	},
	blng_sents_part: {
		'sentence-pair': [{
			sentence: 'He had erased the wrong word.',
			'sentence-translation': '他擦去了写错的字。',
		}],
	},
}, 'word');
assert.ok(currentResponseShape);
assert.equal(currentResponseShape.word, 'word');
assert.deepEqual(currentResponseShape.definitions, [{pos: 'n.', trans: '字，词，单词'}]);
assert.deepEqual(currentResponseShape.tags, ['初中', 'CET4']);
assert.deepEqual(currentResponseShape.exchange, [{name: '复数', value: 'words'}]);
assert.deepEqual(currentResponseShape.webTrans, [{key: 'Word', value: ['字', '单词']}]);
assert.deepEqual(currentResponseShape.bilingualExamples, [{
	eng: 'He had erased the wrong word.',
	chn: '他擦去了写错的字。',
}]);

const legacyResponseShape = parseYoudaoResponse({
	ec: {
		word: [{
			'return-phrase': ' legacy ',
			ukphone: ' test ',
			trs: [{tr: [{pos: 'adj.', l: {i: ['旧格式']}}]}],
		}],
	},
}, 'fallback');
assert.ok(legacyResponseShape);
assert.equal(legacyResponseShape.word, 'legacy');
assert.equal(legacyResponseShape.ph_uk, 'test');

const malformedResponseShape = parseYoudaoResponse({
	ec: {
		word: [{
			'return-phrase': {unexpected: 'object'},
			ukphone: 42,
			usphone: {unexpected: true},
			trs: [
				{tr: [{pos: 7, l: {i: [null, {value: 'v. 可安全解析'}]}}]},
				{tr: [{l: {i: [{unexpected: true}]}}]},
			],
			wfs: [
				{wf: {name: '复数', value: 3}},
				{wf: {name: {value: '过去式'}, value: 'tested'}},
			],
		}],
		exam_type: ['CET4', null, 10, 'CET4'],
	},
}, 'fallback');
assert.ok(malformedResponseShape);
assert.equal(malformedResponseShape.word, 'fallback');
assert.equal(malformedResponseShape.ph_uk, '');
assert.equal(malformedResponseShape.ph_us, '');
assert.deepEqual(malformedResponseShape.definitions, [{pos: 'v.', trans: '可安全解析'}]);
assert.deepEqual(malformedResponseShape.tags, ['CET4']);
assert.deepEqual(malformedResponseShape.exchange, [{name: '过去式', value: 'tested'}]);
assert.equal(parseYoudaoResponse({}, 'empty'), null);

const entry = { word: 'test', ph_uk: '', ph_us: '', audio_uk: '', audio_us: '', definitions: [], tags: [], exchange: [] };

let now = 0;
const waits = [];
const wait = async ms => { waits.push(ms); now += ms; };
const provider = new YoudaoProvider(() => 2000, async () => entry, wait, () => now, () => 0);
await provider.lookup('one');
await provider.lookup('two');
assert.deepEqual(waits, [2000]);

now = 0;
const retryWaits = [];
let attempts = 0;
const retryProvider = new YoudaoProvider(
	() => 2000,
	async () => { if (attempts++ === 0) throw new YoudaoRequestError('server', 503); return entry; },
	async ms => { retryWaits.push(ms); now += ms; },
	() => now,
	() => 0
);
assert.equal(await retryProvider.lookup('retry'), entry);
assert.deepEqual(retryWaits, [1000, 1000]);

now = 0;
const cooldownWaits = [];
let limited = true;
const cooldownProvider = new YoudaoProvider(
	() => 2000,
	async () => { if (limited) { limited = false; throw new YoudaoRequestError('limited', 429); } return entry; },
	async ms => { cooldownWaits.push(ms); now += ms; },
	() => now,
	() => 0
);
await assert.rejects(() => cooldownProvider.lookup('limited'), /暂停 5 分钟/);
await assert.rejects(() => cooldownProvider.lookup('during-cooldown'), /仍在冷却中/);
assert.deepEqual(cooldownWaits, [], 'cooldown must fail immediately instead of silently waiting');
now += 300000;
await cooldownProvider.lookup('after');

console.log('Youdao provider tests passed');
