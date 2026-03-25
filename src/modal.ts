import { App, Modal, Setting } from 'obsidian';
import { Notice } from 'obsidian';

export interface BatchUpdateStats {
	total: number;
	updated: number;
	pending: number;
}

export class ProgressNoticeWidget {
	private notice: Notice;
	private titleEl: HTMLElement;
	private wordEl: HTMLElement;
	private progressBar: HTMLProgressElement;
	private abortBtn: HTMLButtonElement;
	private isAborted = false;
	private onComplete: (() => void) | null = null;

	constructor(type: 'sync' | 'update', total: number, onAbort: () => void) {
		this.notice = new Notice('', 0);
		this.notice.messageEl.addClass('linkdict-progress-notice');
		this.notice.messageEl.empty();

		this.titleEl = this.notice.messageEl.createEl('div', { cls: 'linkdict-notice-title' });
		this.titleEl.textContent = type === 'sync' ? 'LinkDict 正在同步...' : 'LinkDict 正在更新...';

		this.wordEl = this.notice.messageEl.createEl('div', { cls: 'linkdict-notice-word' });

		this.progressBar = this.notice.messageEl.createEl('progress', { cls: 'linkdict-notice-progress' });
		this.progressBar.value = 0;
		this.progressBar.max = total;

		this.abortBtn = this.notice.messageEl.createEl('button', { cls: 'linkdict-notice-abort mod-warning' });
		this.abortBtn.textContent = '停止';
		this.abortBtn.onclick = () => {
			this.isAborted = true;
			this.abortBtn.textContent = '正在停止...';
			this.abortBtn.disabled = true;
			onAbort();
		};
	}

	update(current: number, total: number, word: string): void {
		this.progressBar.value = current;
		this.progressBar.max = total;
		this.wordEl.textContent = `${word} (${current}/${total})`;
	}

	isAbortedByUser(): boolean {
		return this.isAborted;
	}

	setAborted(count: number): void {
		this.notice.messageEl.empty();
		this.notice.messageEl.addClass('linkdict-notice-complete');
		this.notice.messageEl.createEl('div', { cls: 'linkdict-notice-result' })
			.textContent = `同步已中止。成功更新 ${count} 个词。`;
		setTimeout(() => this.hide(), 3000);
	}

	setComplete(uploaded: number, downloaded: number): void {
		this.notice.messageEl.empty();
		this.notice.messageEl.addClass('linkdict-notice-complete');
		this.notice.messageEl.createEl('div', { cls: 'linkdict-notice-result' })
			.textContent = `同步完成。上传：${uploaded}，下载：${downloaded}`;
		setTimeout(() => this.hide(), 3000);
	}

	hide(): void {
		this.notice.hide();
		if (this.onComplete) {
			this.onComplete();
		}
	}

	setOnComplete(callback: () => void): void {
		this.onComplete = callback;
	}
}

export class BatchUpdateModal extends Modal {
	private stats: BatchUpdateStats;
	private onStart: () => void;
	private handleClose: () => void;

	constructor(
		app: App,
		stats: BatchUpdateStats,
		onStart: () => void,
		handleClose: () => void
	) {
		super(app);
		this.stats = stats;
		this.onStart = onStart;
		this.handleClose = handleClose;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('linkdict-modal-container', 'linkdict-batch-update-modal');

		contentEl.createEl('h2', { text: '批量更新释义' });

		const statsGrid = contentEl.createEl('div', { cls: 'linkdict-stats-grid' });

		const totalCard = statsGrid.createEl('div', { cls: 'linkdict-stat-card' });
		totalCard.createEl('div', { cls: 'linkdict-stat-value', text: String(this.stats.total) });
		totalCard.createEl('div', { cls: 'linkdict-stat-label', text: '总单词数' });

		const updatedCard = statsGrid.createEl('div', { cls: 'linkdict-stat-card linkdict-stat-success' });
		updatedCard.createEl('div', { cls: 'linkdict-stat-value', text: String(this.stats.updated) });
		updatedCard.createEl('div', { cls: 'linkdict-stat-label', text: '已更新详尽释义' });

		const pendingCard = statsGrid.createEl('div', { cls: 'linkdict-stat-card linkdict-stat-warning' });
		pendingCard.createEl('div', { cls: 'linkdict-stat-value', text: String(this.stats.pending) });
		pendingCard.createEl('div', { cls: 'linkdict-stat-label', text: '待更新基础释义' });

		if (this.stats.pending === 0) {
			contentEl.createEl('p', { text: '没有需要更新的单词', cls: 'linkdict-no-pending' });
			new Setting(contentEl)
				.addButton((btn) => {
					btn
						.setButtonText('关闭')
						.onClick(() => this.close());
				});
		} else {
			new Setting(contentEl)
				.addButton((btn) => {
					btn
						.setButtonText('开始批量更新')
						.setCta()
						.onClick(() => {
							this.close();
							this.onStart();
						});
				})
				.addButton((btn) => {
					btn
						.setButtonText('取消')
						.onClick(() => this.close());
				});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.handleClose();
	}
}