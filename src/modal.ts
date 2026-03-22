import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';
import { SyncPreview } from './sync';

export class ConfirmSyncModal extends Modal {
	private preview: SyncPreview;
	private onConfirm: () => void;
	private onCancel: () => void;

	constructor(
		app: App,
		preview: SyncPreview,
		onConfirm: () => void,
		onCancel: () => void
	) {
		super(app);
		this.preview = preview;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: t('confirm_title') });
		
		contentEl.createEl('p', {
			text: t('confirm_deleteWarning'),
			cls: 'sync-warning-text'
		});

		const list = contentEl.createEl('ul', { cls: 'sync-preview-list' });
		
		if (this.preview.toDeleteFromCloud > 0) {
			list.createEl('li', {
				text: t('confirm_cloudDeletions', { count: this.preview.toDeleteFromCloud })
			});
		}
		
		if (this.preview.toMarkDeleted > 0) {
			list.createEl('li', {
				text: t('confirm_localDeletions', { count: this.preview.toMarkDeleted })
			});
		}

		const totalDeletions = this.preview.toDeleteFromCloud + this.preview.toMarkDeleted;
		list.createEl('li', {
			text: t('confirm_totalDeletions', { count: totalDeletions }),
			cls: 'sync-total-deletions'
		});

		contentEl.createEl('p', { text: t('confirm_proceed') });

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