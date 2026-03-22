import {AbstractInputSuggest, App, PluginSettingTab, Setting, TAbstractFile, TFolder} from "obsidian";
import LinkDictPlugin from "./main";
import {t, detectLanguage, setLanguage} from "./i18n";
import {SyncDirection} from "./sync";

export type DictionarySource = 'eudic' | 'youdao';

export interface LinkDictSettings {
	folderPath: string;
	saveTags: boolean;
	showWebTrans: boolean;
	showExamples: boolean;
	eudicToken: string;
	eudicDefaultListId: string;
	enableSync: boolean;
	autoSync: boolean;
	syncInterval: number;
	syncOnStartup: boolean;
	startupDelay: number;
	syncDirection: SyncDirection;
	language: string;
	autoLinkFirstOnly: boolean;
	autoAddToEudic: boolean;
	cloudDeletedFolder: string;
	batchChunkSize: number;
	batchDelayMs: number;
	dictionarySource: DictionarySource;
	syncConcurrency: number;
}

export const DEFAULT_SETTINGS: LinkDictSettings = {
	folderPath: 'LinkDict',
	saveTags: true,
	showWebTrans: true,
	showExamples: true,
	eudicToken: '',
	eudicDefaultListId: '',
	enableSync: false,
	autoSync: false,
	syncInterval: 30,
	syncOnStartup: false,
	startupDelay: 10,
	syncDirection: 'bidirectional',
	language: 'auto',
	autoLinkFirstOnly: true,
	autoAddToEudic: true,
	cloudDeletedFolder: 'LinkDict/trash',
	batchChunkSize: 20,
	batchDelayMs: 10000,
	dictionarySource: 'eudic',
	syncConcurrency: 3,
};

export class LinkDictSettingTab extends PluginSettingTab {
	plugin: LinkDictPlugin;

	constructor(app: App, plugin: LinkDictPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		this.renderGeneralSettings(containerEl);
		this.renderDisplaySettings(containerEl);
		this.renderLinkSettings(containerEl);
		this.renderEudicSettings(containerEl);
		this.renderSyncSettings(containerEl);
	}

	private renderGeneralSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings_wordStorageFolder'))
			.setDesc(t('settings_wordStorageFolderDesc'))
			.addText((text) => {
				new FolderSuggest(this.app, text.inputEl);
				text
					.setPlaceholder(t('ui_inputWord'))
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_saveExamTags'))
			.setDesc(t('settings_saveExamTagsDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.saveTags)
					.onChange(async (value) => {
						this.plugin.settings.saveTags = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Language / 语言')
			.setDesc('Choose display language / 选择显示语言')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('auto', 'Auto / 自动')
					.addOption('en', 'English')
					.addOption('zh', '中文')
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value;
						if (value === 'auto') {
							setLanguage(detectLanguage());
						} else {
							setLanguage(value as 'en' | 'zh');
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private renderDisplaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings_displayPreferences'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings_showWebTranslations'))
			.setDesc(t('settings_showWebTranslationsDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showWebTrans)
					.onChange(async (value) => {
						this.plugin.settings.showWebTrans = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_showBilingualExamples'))
			.setDesc(t('settings_showBilingualExamplesDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showExamples)
					.onChange(async (value) => {
						this.plugin.settings.showExamples = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderLinkSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings_linkSettings'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings_autoLinkFirstOnly'))
			.setDesc(t('settings_autoLinkFirstOnlyDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoLinkFirstOnly)
					.onChange(async (value) => {
						this.plugin.settings.autoLinkFirstOnly = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_autoAddToEudic'))
			.setDesc(t('settings_autoAddToEudicDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoAddToEudic)
					.onChange(async (value) => {
						this.plugin.settings.autoAddToEudic = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderEudicSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings_eudicIntegration'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings_dictionarySource'))
			.setDesc(t('settings_dictionarySourceDesc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('eudic', t('settings_sourceEudic'))
					.addOption('youdao', t('settings_sourceYoudao'))
					.setValue(this.plugin.settings.dictionarySource)
					.onChange(async (value) => {
						this.plugin.settings.dictionarySource = value as 'eudic' | 'youdao';
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_eudicApiToken'))
			.setDesc(t('settings_eudicApiTokenDesc'))
			.addText((text) => {
				text
					.setPlaceholder(t('settings_eudicApiToken'))
					.setValue(this.plugin.settings.eudicToken)
					.onChange(async (value) => {
						this.plugin.settings.eudicToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName(t('settings_defaultVocabularyList'))
			.setDesc(t('settings_defaultVocabularyListDesc'))
			.addText((text) => {
				text
					.setPlaceholder('0')
					.setValue(this.plugin.settings.eudicDefaultListId)
					.onChange(async (value) => {
						this.plugin.settings.eudicDefaultListId = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_cloudDeletedFolder'))
			.setDesc(t('settings_cloudDeletedFolderDesc'))
			.addText((text) => {
				new FolderSuggest(this.app, text.inputEl);
				text
					.setPlaceholder('Linkdict/trash')
					.setValue(this.plugin.settings.cloudDeletedFolder)
					.onChange(async (value) => {
						this.plugin.settings.cloudDeletedFolder = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderSyncSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings_syncSettings'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings_enableSync'))
			.setDesc(t('settings_enableSyncDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableSync)
					.onChange(async (value) => {
						this.plugin.settings.enableSync = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (!this.plugin.settings.enableSync) return;

		new Setting(containerEl)
			.setName(t('settings_syncDirection'))
			.setDesc(t('settings_syncDirectionDesc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('bidirectional', t('settings_bidirectional'))
					.addOption('to-eudic', t('settings_syncToEudic'))
					.addOption('from-eudic', t('settings_syncFromEudic'))
					.setValue(this.plugin.settings.syncDirection)
					.onChange(async (value) => {
						this.plugin.settings.syncDirection = value as SyncDirection;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_syncOnStartup'))
			.setDesc(t('settings_syncOnStartupDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.syncOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.syncOnStartup = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_startupDelay'))
			.setDesc(t('settings_startupDelayDesc'))
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.startupDelay))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.startupDelay = num;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.type = 'number';
			});

		new Setting(containerEl)
			.setName(t('settings_autoSync'))
			.setDesc(t('settings_autoSyncDesc'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
						this.plugin.restartSyncTimer();
					});
			});

		new Setting(containerEl)
			.setName(t('settings_syncInterval'))
			.setDesc(t('settings_syncIntervalDesc'))
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.syncInterval))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 5) {
							this.plugin.settings.syncInterval = num;
							await this.plugin.saveSettings();
							this.plugin.restartSyncTimer();
						}
					});
				text.inputEl.type = 'number';
			});

		new Setting(containerEl)
			.setName(t('settings_batchSettings'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings_syncConcurrency'))
			.setDesc(t('settings_syncConcurrencyDesc'))
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.syncConcurrency))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1 && num <= 10) {
							this.plugin.settings.syncConcurrency = num;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.type = 'number';
			});

		new Setting(containerEl)
			.setName(t('settings_batchChunkSize'))
			.setDesc(t('settings_batchChunkSizeDesc'))
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.batchChunkSize))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1 && num <= 100) {
							this.plugin.settings.batchChunkSize = num;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.type = 'number';
			});

		new Setting(containerEl)
			.setName(t('settings_batchDelay'))
			.setDesc(t('settings_batchDelayDesc'))
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.batchDelayMs / 1000))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.batchDelayMs = num * 1000;
							await this.plugin.saveSettings();
						}
					});
				text.inputEl.type = 'number';
			});
	}
}

class FolderSuggest extends AbstractInputSuggest<string> {
	inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(inputStr: string): string[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: string[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((folder: TAbstractFile) => {
			if (folder instanceof TFolder) {
				folders.push(folder.path);
			}
		});

		return folders.filter((folder: string) =>
			folder.toLowerCase().includes(lowerCaseInputStr)
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.inputEl.value = value;
		this.inputEl.trigger('input');
		this.close();
	}
}