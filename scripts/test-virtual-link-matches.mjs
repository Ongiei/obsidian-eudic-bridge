import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-virtual-link-matches-'));
const outfile = join(tmp, 'virtual-link-matches.mjs');

await esbuild.build({
	entryPoints: ['src/reading/virtual-link-matches.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
});

const {
	findVirtualLinkWordMatches,
	isExcludedVirtualLinkSyntax,
} = await import(pathToFileURL(outfile).href);

const words = text => findVirtualLinkWordMatches(text).map(match => match.word);

assert.deepEqual(words('*generates* _generates_ **generates** __generates__'), [
	'generates',
	'generates',
	'generates',
	'generates',
]);
assert.deepEqual(words('plain generates and well-known words'), [
	'plain',
	'generates',
	'and',
	'well-known',
	'words',
]);
assert.deepEqual(words('snake_case foo_generates generates_bar'), []);
assert.equal(isExcludedVirtualLinkSyntax('InlineCode'), true);
assert.equal(isExcludedVirtualLinkSyntax('Link'), true);
assert.equal(isExcludedVirtualLinkSyntax('Emphasis'), false);
assert.equal(isExcludedVirtualLinkSyntax('Formatting'), false);

console.log('Virtual-link match tests passed');
