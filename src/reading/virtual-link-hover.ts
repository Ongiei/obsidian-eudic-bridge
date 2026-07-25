export const VIRTUAL_LINK_HOVER_DELAY_MS = 450;

type TimerWindow = Pick<Window, 'setTimeout' | 'clearTimeout'>;

interface PendingHover {
	anchor: HTMLElement;
	ownerWindow: TimerWindow;
	timerId: number;
}

export class VirtualLinkHoverScheduler {
	private pending: PendingHover | null = null;

	schedule(ownerWindow: TimerWindow, anchor: HTMLElement, callback: () => void): void {
		this.cancel();
		const pending: PendingHover = {anchor, ownerWindow, timerId: 0};
		pending.timerId = ownerWindow.setTimeout(() => {
			if (this.pending !== pending) return;
			this.pending = null;
			if (anchor.isConnected) callback();
		}, VIRTUAL_LINK_HOVER_DELAY_MS);
		this.pending = pending;
	}

	cancel(anchor?: HTMLElement): void {
		if (!this.pending || (anchor && this.pending.anchor !== anchor)) return;
		this.pending.ownerWindow.clearTimeout(this.pending.timerId);
		this.pending = null;
	}
}
