import {Editor, setIcon, setTooltip} from 'obsidian';
import LinkDictPlugin from './main';
import {DictEntry, EditorWithCM} from './types';
import {t} from './i18n';

export class DefinitionPopover {
	private overlay: HTMLElement | null = null;
	private entry: DictEntry | null = null;
	private abortController: AbortController | null = null;

	constructor(
		private plugin: LinkDictPlugin,
		private editor: Editor,
		private originalWord: string,
		entry?: DictEntry
	) {
		this.entry = entry ?? null;
		this.createPopover();
	}

	private createPopover() {
		this.removeExistingPopover();

		const cursorFrom = this.editor.getCursor('from');
		const cm = (this.editor as unknown as EditorWithCM).cm;
		const pos = this.editor.posToOffset(cursorFrom);
		const coords = cm?.coordsAtPos(pos);

		if (!coords) {
			return;
		}

		this.overlay = document.createElement('div');
		this.overlay.className = 'link-dict-popover';
		document.body.appendChild(this.overlay);

		const offset = 15;
		const estimatedWidth = 320;
		const estimatedHeight = 320;

		const spaceBelow = window.innerHeight - coords.bottom;
		const spaceRight = window.innerWidth - coords.right;

		let originV = 'top';
		let originH = 'left';

		this.overlay.style.top = '';
		this.overlay.style.bottom = '';
		this.overlay.style.left = '';
		this.overlay.style.right = '';

		if (spaceBelow < estimatedHeight) {
			const distanceFromBottom = window.innerHeight - coords.top + offset;
			this.overlay.style.bottom = `${distanceFromBottom}px`;
			this.overlay.style.top = 'auto';
			originV = 'bottom';
		} else {
			this.overlay.style.top = `${coords.bottom + offset}px`;
			this.overlay.style.bottom = 'auto';
			originV = 'top';
		}

		if (spaceRight < estimatedWidth) {
			const distanceFromRight = window.innerWidth - coords.left + offset;
			this.overlay.style.right = `${distanceFromRight}px`;
			this.overlay.style.left = 'auto';
			originH = 'right';
		} else {
			this.overlay.style.left = `${coords.left + offset}px`;
			this.overlay.style.right = 'auto';
			originH = 'left';
		}

		this.overlay.classList.remove('popover-origin-top-left', 'popover-origin-top-right', 'popover-origin-bottom-left', 'popover-origin-bottom-right');
		this.overlay.classList.add(`popover-origin-${originV}-${originH}`);

		this.renderContent();

		this.abortController = new AbortController();
		setTimeout(() => {
			if (this.overlay) {
				this.overlay.classList.add('active');
				window.addEventListener('mousedown', this.onWindowClick, { 
					capture: true, 
					signal: this.abortController!.signal 
				});
			}
		}, 10);
	}

	public setEntry(entry: DictEntry) {
		this.entry = entry;
		this.renderContent();
	}

	private removeExistingPopover() {
		const existing = document.querySelector('.link-dict-popover');
		if (existing) {
			existing.remove();
		}
		this.cleanupListeners();
	}

	private cleanupListeners() {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	private renderContent() {
		if (!this.overlay) return;

		this.overlay.innerHTML = '';

		if (!this.entry) {
			const loading = document.createElement('div');
			loading.className = 'popover-loading';
			loading.textContent = t('ui_loading');
			this.overlay.appendChild(loading);
			return;
		}

		const header = document.createElement('div');
		header.className = 'popover-header';

		const headerContainer = document.createElement('div');
		headerContainer.className = 'dict-header-container';

		const headerLeft = document.createElement('div');
		headerLeft.className = 'dict-header-left';

		const title = document.createElement('h1');
		title.className = 'dict-title';
		title.textContent = this.originalWord;
		headerLeft.appendChild(title);

		if (this.entry.ph_uk || this.entry.ph_us) {
			const phoneticContainer = document.createElement('div');
			phoneticContainer.className = 'dict-phonetic-container';

			if (this.entry.ph_uk) {
				const ukPhoneticBtn = document.createElement('div');
				ukPhoneticBtn.className = 'dict-phonetic-btn';
				ukPhoneticBtn.textContent = `${t('view_uk')} /${this.entry.ph_uk}/`;
				if (this.entry.audio_uk) {
					ukPhoneticBtn.addEventListener('click', () => {
						void new Audio(this.entry!.audio_uk).play();
					});
				}
				phoneticContainer.appendChild(ukPhoneticBtn);
			}

			if (this.entry.ph_us) {
				const usPhoneticBtn = document.createElement('div');
				usPhoneticBtn.className = 'dict-phonetic-btn';
				usPhoneticBtn.textContent = `${t('view_us')} /${this.entry.ph_us}/`;
				if (this.entry.audio_us) {
					usPhoneticBtn.addEventListener('click', () => {
						void new Audio(this.entry!.audio_us).play();
					});
				}
				phoneticContainer.appendChild(usPhoneticBtn);
			}

			headerLeft.appendChild(phoneticContainer);
		}

		headerContainer.appendChild(headerLeft);

		const actionContainer = document.createElement('div');
		actionContainer.className = 'popover-actions';

		const createNoteBtn = document.createElement('button');
		createNoteBtn.className = 'dict-action-btn';
		setIcon(createNoteBtn, 'file-plus');
		setTooltip(createNoteBtn, t('ui_createLemmaNote'));
		createNoteBtn.addEventListener('click', () => {
			void (async () => {
				await this.plugin.searchAndGenerateNote(this.originalWord);
				this.close();
			})();
		});
		actionContainer.appendChild(createNoteBtn);

		if (this.plugin.settings.eudicToken) {
			const addToEudicBtn = document.createElement('button');
			addToEudicBtn.className = 'dict-action-btn';
			setIcon(addToEudicBtn, 'plus-circle');
			setTooltip(addToEudicBtn, t('ui_addToEudic'));
			addToEudicBtn.addEventListener('click', () => {
				void this.plugin.addToEudic(this.originalWord);
			});
			actionContainer.appendChild(addToEudicBtn);
		}

		headerContainer.appendChild(actionContainer);

		header.appendChild(headerContainer);
		this.overlay.appendChild(header);

		if (this.entry.definitions.length > 0) {
			const definitionsList = document.createElement('div');
			definitionsList.className = 'popover-definitions-list';
			this.entry.definitions.forEach((def) => {
				const defRow = document.createElement('div');
				defRow.className = 'popover-def-row';
				if (def.pos) {
					const posEl = document.createElement('span');
					posEl.className = 'popover-pos-label';
					posEl.textContent = def.pos;
					defRow.appendChild(posEl);
				}
				const transEl = document.createElement('span');
				transEl.className = 'popover-def-text';
				transEl.textContent = def.trans.replace(/\[/g, '\\[');
				defRow.appendChild(transEl);
				definitionsList.appendChild(defRow);
			});
			this.overlay.appendChild(definitionsList);
		}

		if (this.entry.tags.length > 0 || this.entry.exchange.length > 0) {
			const footer = document.createElement('div');
			footer.className = 'popover-footer';

			if (this.entry.tags.length > 0) {
				const tagsContainer = document.createElement('div');
				tagsContainer.className = 'popover-tags-container';
				this.entry.tags.forEach((tag) => {
					const tagEl = document.createElement('span');
					tagEl.className = 'popover-tag-exam';
					tagEl.textContent = tag;
					tagsContainer.appendChild(tagEl);
				});
				footer.appendChild(tagsContainer);
			}

			if (this.entry.exchange.length > 0) {
				const formsList = document.createElement('div');
				formsList.className = 'popover-exchange-list';
				this.entry.exchange.forEach((item) => {
					const formItem = document.createElement('span');
					formItem.className = 'popover-tag-form';
					const label = document.createElement('span');
					label.className = 'popover-form-label';
					label.textContent = `${item.name}:`;
					const value = document.createElement('span');
					value.className = 'popover-form-value';
					value.textContent = item.value;
					formItem.appendChild(label);
					formItem.appendChild(value);
					formsList.appendChild(formItem);
				});
				footer.appendChild(formsList);
			}

			this.overlay.appendChild(footer);
		}
	}

	private onWindowClick = (event: MouseEvent) => {
		if (this.overlay && !this.overlay.contains(event.target as Node)) {
			this.close();
		}
	};

	public close() {
		this.cleanupListeners();
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = null;
		}
	}
}