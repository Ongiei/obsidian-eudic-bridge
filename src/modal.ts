import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';
import type { SyncDryRunResult, ExternalChanges, ExternalChangesResolution } from './sync';

export class ExternalChangesModal extends Modal {
	private externalChanges: ExternalChanges;
	private onConfirm: (resolution: ExternalChangesResolution) => void;
	private onCancel: () => void;
	private resolution: ExternalChangesResolution = {
		deletedAction: 'ignore',
		addedAction: 'ignore',
	};

	constructor(
		app: App,
		externalChanges: ExternalChanges,
		onConfirm: (resolution: ExternalChangesResolution) => void,
		onCancel: () => void
	) {
		super(app);
		this.externalChanges = externalChanges;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('link-dict-external-changes-modal');

		contentEl.createEl('h2', { text: t('external_changes_title') });
		contentEl.createEl('p', { text: t('external_changes_description'), cls: 'modal-description' });

		// Section for possibly deleted locally
		if (this.externalChanges.possiblyDeletedLocally.length > 0) {
			const deletedSection = contentEl.createEl('div', { cls: 'external-changes-section' });
			deletedSection.createEl('h3', { text: t('external_deleted_section') });
			
			const wordList = deletedSection.createEl('div', { cls: 'external-word-list' });
			wordList.textContent = this.externalChanges.possiblyDeletedLocally.slice(0, 10).join(', ') +
				(this.externalChanges.possiblyDeletedLocally.length > 10 ? ` ... (${this.externalChanges.possiblyDeletedLocally.length} total)` : '');

			new Setting(deletedSection)
				.setName(t('external_deleted_action'))
				.setDesc(t('external_deleted_action_desc'))
				.addDropdown(dropdown => {
					dropdown
						.addOption('delete_from_cloud', t('external_deleted_delete_cloud'))
						.addOption('redownload', t('external_deleted_redownload'))
						.addOption('ignore', t('external_ignore'))
						.setValue(this.resolution.deletedAction)
						.onChange(value => {
							this.resolution.deletedAction = value as ExternalChangesResolution['deletedAction'];
						});
				});
		}

		// Section for possibly added locally
		if (this.externalChanges.possiblyAddedLocally.length > 0) {
			const addedSection = contentEl.createEl('div', { cls: 'external-changes-section' });
			addedSection.createEl('h3', { text: t('external_added_section') });
			
			const wordList = addedSection.createEl('div', { cls: 'external-word-list' });
			wordList.textContent = this.externalChanges.possiblyAddedLocally.slice(0, 10).join(', ') +
				(this.externalChanges.possiblyAddedLocally.length > 10 ? ` ... (${this.externalChanges.possiblyAddedLocally.length} total)` : '');

			new Setting(addedSection)
				.setName(t('external_added_action'))
				.setDesc(t('external_added_action_desc'))
				.addDropdown(dropdown => {
					dropdown
						.addOption('upload', t('external_added_upload'))
						.addOption('delete_local', t('external_added_delete_local'))
						.addOption('ignore', t('external_ignore'))
						.setValue(this.resolution.addedAction)
						.onChange(value => {
							this.resolution.addedAction = value as ExternalChangesResolution['addedAction'];
						});
				});
		}

		new Setting(contentEl)
			.addButton(btn => {
				btn
					.setButtonText(t('confirm_cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					});
			})
			.addButton(btn => {
				btn
					.setButtonText(t('external_continue'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm(this.resolution);
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class SyncConfirmationModal extends Modal {
	private dryRunResult: SyncDryRunResult;
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		dryRunResult: SyncDryRunResult,
		onConfirm: () => void,
		onCancel: () => void
	) {
		super(app);
		this.dryRunResult = dryRunResult;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('link-dict-sync-modal');

		contentEl.createEl('h2', { text: t('sync_confirm_title') });

		const totalChanges = this.dryRunResult.toDownload.length +
			this.dryRunResult.toUpload.length +
			this.dryRunResult.toDeleteLocal.length +
			this.dryRunResult.toDeleteFromCloud.length;

		if (totalChanges === 0) {
			contentEl.createEl('p', { text: t('sync_no_changes') });
			
			new Setting(contentEl)
				.addButton((btn) => {
					btn
						.setButtonText(t('confirm_cancel'))
						.onClick(() => this.close());
				});
			return;
		}

		contentEl.createEl('p', { text: t('sync_confirm_description') });

		const list = contentEl.createEl('ul', { cls: 'sync-change-list' });

		if (this.dryRunResult.toDownload.length > 0) {
			const li = list.createEl('li', { cls: 'sync-change-item sync-change-download' });
			li.createEl('strong', { text: `${t('sync_action_download')} (${this.dryRunResult.toDownload.length})` });
			const wordList = li.createEl('span', { cls: 'sync-word-preview' });
			wordList.textContent = ': ' + this.dryRunResult.toDownload.slice(0, 5).map(c => c.word).join(', ') +
				(this.dryRunResult.toDownload.length > 5 ? ' ...' : '');
		}

		if (this.dryRunResult.toUpload.length > 0) {
			const li = list.createEl('li', { cls: 'sync-change-item sync-change-upload' });
			li.createEl('strong', { text: `${t('sync_action_upload')} (${this.dryRunResult.toUpload.length})` });
			const wordList = li.createEl('span', { cls: 'sync-word-preview' });
			wordList.textContent = ': ' + this.dryRunResult.toUpload.slice(0, 5).map(c => c.word).join(', ') +
				(this.dryRunResult.toUpload.length > 5 ? ' ...' : '');
		}

		if (this.dryRunResult.toDeleteLocal.length > 0) {
			const li = list.createEl('li', { cls: 'sync-change-item sync-change-delete-local' });
			li.createEl('strong', { text: `${t('sync_action_delete_local')} (${this.dryRunResult.toDeleteLocal.length})` });
			const wordList = li.createEl('span', { cls: 'sync-word-preview' });
			wordList.textContent = ': ' + this.dryRunResult.toDeleteLocal.slice(0, 5).map(c => c.word).join(', ') +
				(this.dryRunResult.toDeleteLocal.length > 5 ? ' ...' : '');
		}

		if (this.dryRunResult.toDeleteFromCloud.length > 0) {
			const li = list.createEl('li', { cls: 'sync-change-item sync-change-delete-cloud' });
			li.createEl('strong', { text: `${t('sync_action_delete_cloud')} (${this.dryRunResult.toDeleteFromCloud.length})` });
			const wordList = li.createEl('span', { cls: 'sync-word-preview' });
			wordList.textContent = ': ' + this.dryRunResult.toDeleteFromCloud.slice(0, 5).map(c => c.word).join(', ') +
				(this.dryRunResult.toDeleteFromCloud.length > 5 ? ' ...' : '');
		}

		if (this.dryRunResult.errors.length > 0) {
			const errorDiv = contentEl.createEl('div', { cls: 'sync-error-list' });
			errorDiv.createEl('strong', { text: t('sync_errors') + ':' });
			for (const err of this.dryRunResult.errors) {
				errorDiv.createEl('div', { text: err, cls: 'sync-error-item' });
			}
		}

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText(t('confirm_cancel'))
					.onClick(() => {
						this.close();
						this.onCancel();
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText(t('confirm_continue'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}