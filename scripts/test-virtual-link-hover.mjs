import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'lexibridge-virtual-link-hover-'));
const outfile = join(tmp, 'virtual-link-hover.mjs');

await esbuild.build({
	entryPoints: ['src/reading/virtual-link-hover.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
});

const {VIRTUAL_LINK_HOVER_DELAY_MS, VirtualLinkHoverScheduler} = await import(pathToFileURL(outfile).href);

let nextTimerId = 1;
const timers = new Map();
const ownerWindow = {
	setTimeout(callback, delay) {
		const id = nextTimerId++;
		timers.set(id, {callback, delay});
		return id;
	},
	clearTimeout(id) {
		timers.delete(id);
	},
};

function runOnlyTimer() {
	assert.equal(timers.size, 1);
	const [id, timer] = [...timers.entries()][0];
	timers.delete(id);
	timer.callback();
	return timer.delay;
}

const scheduler = new VirtualLinkHoverScheduler();
const firstAnchor = {isConnected: true};
const secondAnchor = {isConnected: true};
let opened = 0;

scheduler.schedule(ownerWindow, firstAnchor, () => opened++);
assert.equal(runOnlyTimer(), VIRTUAL_LINK_HOVER_DELAY_MS);
assert.equal(opened, 1);

scheduler.schedule(ownerWindow, firstAnchor, () => opened++);
scheduler.cancel(firstAnchor);
assert.equal(timers.size, 0);
assert.equal(opened, 1);

scheduler.schedule(ownerWindow, firstAnchor, () => opened++);
scheduler.cancel(secondAnchor);
assert.equal(runOnlyTimer(), VIRTUAL_LINK_HOVER_DELAY_MS);
assert.equal(opened, 2);

scheduler.schedule(ownerWindow, firstAnchor, () => opened++);
scheduler.schedule(ownerWindow, secondAnchor, () => opened++);
assert.equal(timers.size, 1);
assert.equal(runOnlyTimer(), VIRTUAL_LINK_HOVER_DELAY_MS);
assert.equal(opened, 3);

scheduler.schedule(ownerWindow, {isConnected: false}, () => opened++);
runOnlyTimer();
assert.equal(opened, 3);

console.log('Virtual-link hover tests passed');
