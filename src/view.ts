import {ItemView, WorkspaceLeaf, setIcon, setTooltip} from 'obsidian';
import LinkDictPlugin from './main';
import {DictEntry} from './types';
import {t} from './i18n';

export class DictionaryView extends ItemView {
	plugin: LinkDictPlugin;
	searchInput: HTMLInputElement;
	resultContainer: HTMLElement;
	private currentWord: string = '';
	private currentEntry: DictEntry | null = null;

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

		const inputWrapper = searchBarEl.createEl('div', { cls: 'link-dict-input-wrapper' });

		this.searchInput = inputWrapper.createEl('input', {
			type: 'text',
			cls: 'link-dict-search-input',
			attr: { placeholder: t('ui_inputWord') }
		});

		const searchButton = inputWrapper.createEl('button', {
			cls: 'link-dict-search-btn-inside'
		});
		setIcon(searchButton, 'search');
		setTooltip(searchButton, t('ui_search'));
		searchButton.addEventListener('click', () => {
			void this.performSearch();
		});

		const createNoteButton = searchBarEl.createEl('button', {
			cls: 'link-dict-action-btn',
			attr: { 'aria-label': t('ui_createLemmaNote') }
		});
		setIcon(createNoteButton, 'file-plus');
		setTooltip(createNoteButton, t('ui_createLemmaNote'));
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
	}

	async onClose() {
	}

	async performSearch() {
		const word = this.searchInput.value.trim();
		
		if (!word) {
			this.resultContainer.empty();
			const message = this.resultContainer.createEl('p');
			message.addClass('link-dict-message');
			message.setText(t('ui_pleaseEnterWord'));
			return;
		}

		const result = await this.plugin.findEntry(word, false);

		if (!result) {
			this.resultContainer.empty();
			const message = this.resultContainer.createEl('p');
			message.addClass('link-dict-message');
			const textSpan = message.createEl('span');
			textSpan.setText(`${t('ui_noDefinitionFound')} `);
			const strongSpan = message.createEl('strong');
			strongSpan.setText(word);
			return;
		}

		const { entry, word: lemma } = result;
		this.currentWord = lemma;
		this.currentEntry = entry;

		this.resultContainer.empty();
		this.renderEntry(entry, lemma);
	}

	private renderEntry(entry: DictEntry, word: string) {
		const container = this.resultContainer.createEl('div', { cls: 'dict-entry' });

		const headerContainer = container.createEl('div', { cls: 'dict-header-container' });

		const headerLeft = headerContainer.createEl('div', { cls: 'dict-header-left' });

		const title = headerLeft.createEl('h1', { cls: 'dict-title' });
		title.textContent = word;

		if (entry.ph_uk || entry.ph_us) {
			const phoneticContainer = headerLeft.createEl('div', { cls: 'dict-phonetic-container' });

			if (entry.ph_uk) {
				const ukPhoneticBtn = phoneticContainer.createEl('div', { cls: 'dict-phonetic-btn' });
				ukPhoneticBtn.textContent = `${t('view_uk')} /${entry.ph_uk}/`;
				if (entry.audio_uk) {
					ukPhoneticBtn.addEventListener('click', () => {
						void new Audio(entry.audio_uk).play();
					});
				}
				phoneticContainer.appendChild(ukPhoneticBtn);
			}

			if (entry.ph_us) {
				const usPhoneticBtn = phoneticContainer.createEl('div', { cls: 'dict-phonetic-btn' });
				usPhoneticBtn.textContent = `${t('view_us')} /${entry.ph_us}/`;
				if (entry.audio_us) {
					usPhoneticBtn.addEventListener('click', () => {
						void new Audio(entry.audio_us).play();
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
		this.renderSection(container, t('view_webTranslations'), 'dict-web-trans', this.plugin.settings.showWebTrans, entry.webTrans, (details) => {
			const webList = details.createEl('ul', { cls: 'dict-web-list' });
			entry.webTrans!.forEach(item => {
				const li = webList.createEl('li', { cls: 'dict-web-item' });
				const keyEl = li.createEl('span', { cls: 'dict-web-key' });
				keyEl.textContent = `${item.key}: `;
				const valueEl = li.createEl('span', { cls: 'dict-web-value' });
				valueEl.textContent = item.value.map((v, i) => `${i + 1}. ${v}`).join(' ');
			});
		});

		this.renderSection(container, t('view_examples'), 'dict-examples', this.plugin.settings.showExamples, entry.bilingualExamples, (details) => {
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