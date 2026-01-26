import {Editor} from 'obsidian';
import LinkDictPlugin from './main';

interface DictEntry {
	p?: string;
	t?: string;
	e?: string;
	g?: string;
}

export class DefinitionPopover {
	private overlay: HTMLElement;

	constructor(
		private plugin: LinkDictPlugin,
		private editor: Editor,
		private originalWord: string,
		private entry: DictEntry
	) {
		console.debug('DefinitionPopover: Creating popover for:', originalWord);
		this.createPopover();
	}

	private createPopover() {
		console.debug('DefinitionPopover: Starting createPopover');

		this.removeExistingPopover();

		const cursorFrom = this.editor.getCursor('from');
		console.debug('DefinitionPopover: Cursor from:', cursorFrom);

		const editorWithCm = this.editor as unknown as { cm: { coordsAtPos: (pos: number) => { top: number; left: number; bottom: number; height: number; right: number } | null } };
		const cm = editorWithCm.cm;
		const pos = this.editor.posToOffset(cursorFrom);
		const coords = cm.coordsAtPos(pos);

		console.debug('DefinitionPopover: Coords:', coords);

		this.overlay = document.createElement('div');
		this.overlay.className = 'link-dict-popover';
		document.body.appendChild(this.overlay);

		console.debug('DefinitionPopover: Overlay appended to body');

		let top = 0;
		let left = 0;

		if (coords) {
			top = coords.bottom + 5;
			left = coords.left;
			console.debug('DefinitionPopover: Using coords - top:', top, 'left:', left);
		} else {
			top = window.innerHeight / 2;
			left = window.innerWidth / 2;
			console.debug('DefinitionPopover: Coords null, using fallback - top:', top, 'left:', left);
		}

		if (left + 300 > document.body.clientWidth) {
			left = document.body.clientWidth - 310;
			console.debug('DefinitionPopover: Adjusted left to prevent overflow:', left);
		}

		this.overlay.style.top = `${top}px`;
		this.overlay.style.left = `${left}px`;

		console.debug('DefinitionPopover: Final position - top:', top, 'left:', left);

		this.renderContent();

		setTimeout(() => {
			console.debug('DefinitionPopover: Adding mousedown listener');
			window.addEventListener('mousedown', this.onWindowClick, { capture: true });
		}, 100);
	}

	private removeExistingPopover() {
		const existing = document.querySelector('.link-dict-popover');
		if (existing) {
			console.debug('DefinitionPopover: Removing existing popover');
			existing.remove();
		}
	}

	private renderContent() {
		console.debug('DefinitionPopover: Rendering content');

		const header = document.createElement('div');
		header.className = 'popover-header';

		const titleGroup = document.createElement('div');
		titleGroup.className = 'popover-title-group';
		const title = document.createElement('strong');
		title.textContent = this.originalWord;
		titleGroup.appendChild(title);
		if (this.entry.p) {
			const phonetic = document.createElement('span');
			phonetic.className = 'popover-phonetic';
			phonetic.textContent = ` [${this.entry.p}]`;
			titleGroup.appendChild(phonetic);
		}
		header.appendChild(titleGroup);

		const btn = document.createElement('button');
		btn.className = 'popover-create-btn';
		btn.textContent = 'Create lemma note';
		btn.onclick = async () => {
			console.debug('DefinitionPopover: Button clicked, creating note');
			await this.plugin.searchAndGenerateNote(this.originalWord, this.editor);
			this.close();
		};
		header.appendChild(btn);

		this.overlay.appendChild(header);

		const body = document.createElement('div');
		body.className = 'popover-body';
		const lines = this.entry.t?.split('\\n').slice(0, 3) ?? [];
		console.debug('DefinitionPopover: Rendering', lines.length, 'definition lines');
		lines.forEach(line => {
			const div = document.createElement('div');
			div.textContent = line;
			body.appendChild(div);
		});
		this.overlay.appendChild(body);

		console.debug('DefinitionPopover: Content rendered');
	}

	private onWindowClick = (event: MouseEvent) => {
		console.debug('DefinitionPopover: Window clicked, target:', event.target);
		if (!this.overlay.contains(event.target as Node)) {
			console.debug('DefinitionPopover: Click outside, closing');
			this.close();
		}
	};

	public close() {
		console.debug('DefinitionPopover: Closing popover');
		if (this.overlay) {
			this.overlay.remove();
		}
		window.removeEventListener('mousedown', this.onWindowClick, { capture: true });
	}
}
