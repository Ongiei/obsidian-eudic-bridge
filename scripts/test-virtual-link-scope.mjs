import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-virtual-link-scope-'));
const outfile = join(tmp, 'virtual-link-scope.mjs');

await esbuild.build({
	entryPoints: ['src/reading/virtual-link-scope.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
});

const {
	isForegroundDocument,
	isInsideVirtualLinkContainer,
} = await import(pathToFileURL(outfile).href);

const foregroundDocument = {hasFocus: () => true};
const backgroundDocument = {hasFocus: () => false};
assert.equal(isForegroundDocument(foregroundDocument, foregroundDocument), true);
assert.equal(isForegroundDocument(backgroundDocument, foregroundDocument), false);
assert.equal(isForegroundDocument(foregroundDocument, {hasFocus: () => true}), false);

const readingElement = {};
const tocElement = {};
const readingContainer = {contains: element => element === readingElement};
assert.equal(isInsideVirtualLinkContainer(readingElement, [readingContainer]), true);
assert.equal(isInsideVirtualLinkContainer(tocElement, [readingContainer]), false);
assert.equal(isInsideVirtualLinkContainer(readingElement, []), false);

console.log('Virtual-link scope tests passed');
