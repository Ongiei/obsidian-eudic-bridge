import {ItemView, WorkspaceLeaf, setIcon, setTooltip} from 'obsidian';
import LinkDictPlugin from './main';
import {DictEntry} from './types';

export class DictionaryView extends ItemView {
	plugin: LinkDictPlugin;
	searchInput: HTMLInputElement;
	resultContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: LinkDictPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return 'link-dict-view';
	}

	getDisplayText() {
		return 'Link dictionary';
	}

	getIcon() {
		return 'book-open';
	}

	async onOpen() {
		this.containerEl.empty();

		const contentEl = this.containerEl.createEl('div', { cls: 'dict-view-content' });
		contentEl.classList.add('link-dict-sidebar-view');
		contentEl.classList.remove('link-dict-popover');

		const searchBarEl = contentEl.createEl('div', { cls: 'link-dict-search-box' });

		this.searchInput = searchBarEl.createEl('input', {
			type: 'text',
			cls: 'link-dict-search-input',
			attr: { placeholder: 'Input word...' }
		});

		const searchButton = searchBarEl.createEl('button', {
			cls: 'link-dict-search-btn'
		});
		setIcon(searchButton, 'search');

		const createNoteButton = searchBarEl.createEl('button', {
			cls: 'link-dict-search-btn',
			attr: { 'aria-label': 'Create lemma note' }
		});
		setIcon(createNoteButton, 'file-plus');
		setTooltip(createNoteButton, 'Create lemma note');
		createNoteButton.addEventListener('click', () => {
			const word = this.searchInput.value.trim();
			if (word) {
				void this.plugin.searchAndGenerateNote(word);
			}
		});

		this.resultContainer = contentEl.createEl('div', { cls: 'dict-result-container' });

		this.searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				void this.performSearch();
			}
		});

		searchButton.addEventListener('click', () => {
			void this.performSearch();
		});
	}

	async onClose() {
	}

	async performSearch() {
		const word = this.searchInput.value.trim();
		
		if (!word) {
			this.resultContainer.empty();
			const message = this.resultContainer.createEl('p');
			message.addClass('link-dict-message');
			message.setText('Please enter a word to search.');
			return;
		}

		const result = await this.plugin.findEntry(word, false);

		if (!result) {
			this.resultContainer.empty();
			const message = this.resultContainer.createEl('p');
			message.addClass('link-dict-message');
			const textSpan = message.createEl('span');
			textSpan.setText('No definition found for: ');
			const strongSpan = message.createEl('strong');
			strongSpan.setText(word);
			return;
		}

		const { entry, word: lemma } = result;

		this.resultContainer.empty();

		this.renderEntry(entry, lemma);
	}

	private renderEntry(entry: DictEntry, word: string) {
		const container = this.resultContainer.createEl('div', { cls: 'dict-entry' });

		const headerContainer = container.createEl('div', { cls: 'dict-header-container' });

		const headerLeft = headerContainer.createEl('div', { cls: 'dict-header-left' });

		const title = headerLeft.createEl('h1', { cls: 'dict-title' });
		title.textContent = word;

		if (entry.ph_en || entry.ph_am) {
			const phoneticContainer = headerLeft.createEl('div', { cls: 'dict-phonetic-container' });

			if (entry.ph_en) {
				const ukPhoneticBtn = phoneticContainer.createEl('div', { cls: 'dict-phonetic-btn' });
				ukPhoneticBtn.textContent = `UK /${entry.ph_en}/`;
				if (entry.mp3_en) {
					ukPhoneticBtn.addEventListener('click', () => {
						void new Audio(entry.mp3_en).play();
					});
				}
				phoneticContainer.appendChild(ukPhoneticBtn);
			}

			if (entry.ph_am) {
				const usPhoneticBtn = phoneticContainer.createEl('div', { cls: 'dict-phonetic-btn' });
				usPhoneticBtn.textContent = `US /${entry.ph_am}/`;
				if (entry.mp3_am) {
					usPhoneticBtn.addEventListener('click', () => {
						void new Audio(entry.mp3_am).play();
					});
				}
				phoneticContainer.appendChild(usPhoneticBtn);
			}

			headerLeft.appendChild(phoneticContainer);
		}

		if (entry.definitions.length > 0) {
			const definitionsList = container.createEl('div', { cls: 'dict-definitions-list' });
			entry.definitions.forEach((def) => {
				const defRow = definitionsList.createEl('div', { cls: 'dict-def-row' });
				if (def.pos) {
					const posEl = defRow.createEl('span', { cls: 'dict-pos-label' });
					posEl.textContent = def.pos;
				}
				const transEl = defRow.createEl('span', { cls: 'dict-def-text' });
				transEl.textContent = def.trans.replace(/\[/g, '\\[');
			});
		}

		if (entry.tags.length > 0 || entry.exchange.length > 0) {
			const footer = container.createEl('div', { cls: 'dict-footer' });

			if (entry.tags.length > 0) {
				const tagsContainer = footer.createEl('div', { cls: 'dict-tags-container' });
				entry.tags.forEach((tag) => {
					const tagEl = tagsContainer.createEl('span', { cls: 'dict-tag-exam' });
					tagEl.textContent = tag;
				});
			}

			if (entry.exchange.length > 0) {
				const formsList = footer.createEl('div', { cls: 'dict-exchange-list' });
				entry.exchange.forEach((item) => {
					const formItem = formsList.createEl('span', { cls: 'dict-tag-form' });
					const label = formItem.createEl('span', { cls: 'dict-form-label' });
					label.textContent = `${item.name}:`;
					const value = formItem.createEl('span', { cls: 'dict-form-value' });
					value.textContent = item.value;
				});
			}
		}

		this.renderExtendedData(container, entry);
	}

	private renderExtendedData(container: HTMLElement, entry: DictEntry) {
		this.renderSection(container, 'Web Translations', 'dict-web-trans', this.plugin.settings.showWebTrans, entry.webTrans, (details) => {
			const webList = details.createEl('ul', { cls: 'dict-web-list' });
			entry.webTrans!.forEach(item => {
				const li = webList.createEl('li', { cls: 'dict-web-item' });
				const keyEl = li.createEl('span', { cls: 'dict-web-key' });
				keyEl.textContent = `${item.key}: `;
				const valueEl = li.createEl('span', { cls: 'dict-web-value' });
				valueEl.textContent = item.value.map((v, i) => `${i + 1}. ${v}`).join(' ');
			});
		});

		this.renderSection(container, 'Examples', 'dict-examples', this.plugin.settings.showExamples, entry.bilingualExamples, (details) => {
			const examplesList = details.createEl('div', { cls: 'dict-examples-list' });
			entry.bilingualExamples!.forEach(example => {
				const exampleRow = examplesList.createEl('div', { cls: 'dict-example-row' });
				const enEl = exampleRow.createEl('p', { cls: 'dict-example-en' });
				enEl.textContent = example.eng;
				const cnEl = exampleRow.createEl('p', { cls: 'dict-example-cn' });
				cnEl.textContent = example.chn;
			});
		});
	}

	private renderSection<T>(
		container: HTMLElement,
		title: string,
		className: string,
		showSetting: boolean,
		data: T | undefined,
		renderContentFn: (details: HTMLElement) => void
	): void {
		if (!showSetting || !data) {
			return;
		}

		const details = container.createEl('details', { cls: `dict-section ${className}` });
		const summary = details.createEl('summary');
		summary.textContent = title;
		renderContentFn(details);
	}
}