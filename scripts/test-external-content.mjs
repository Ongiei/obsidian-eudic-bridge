import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-external-content-'));
const outfile = join(tmp, 'external-content.mjs');
await esbuild.build({
	entryPoints: ['src/utils/external-content.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
});

const {
	normalizeUntrustedText,
	sanitizeExternalUrl,
	sanitizeMarkdownInline,
} = await import(pathToFileURL(outfile).href);

assert.equal(normalizeUntrustedText('line one\n---\n# injected'), 'line one --- # injected');
assert.equal(normalizeUntrustedText('abcdef', 4), 'abc…');
assert.equal(
	sanitizeMarkdownInline('safe\n[[target]] <script> *bold*'),
	String.raw`safe \[\[target\]\] \<script\> \*bold\*`
);
assert.equal(sanitizeExternalUrl('https://example.com/a'), 'https://example.com/a');
assert.equal(sanitizeExternalUrl('obsidian://open?vault=V', {allowObsidian: true}), 'obsidian://open?vault=V');
assert.equal(sanitizeExternalUrl('http://localhost:8765', {allowHttpHosts: ['localhost']}), 'http://localhost:8765/');
for (const unsafe of [
	'javascript:alert(1)',
	'data:text/html,owned',
	'file:///etc/passwd',
	'http://example.com/insecure',
	'https://example.com/a b',
]) {
	assert.equal(sanitizeExternalUrl(unsafe), null);
}

console.log('External content sanitization tests passed');
