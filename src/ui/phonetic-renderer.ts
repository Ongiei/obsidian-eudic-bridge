import { DictEntry } from '../types';

interface AudioWindow extends Window {
	Audio: new (src?: string) => HTMLAudioElement;
}

export function renderPhoneticButtons(container: HTMLElement, entry: DictEntry): void {
	if (!entry.ph_uk && !entry.ph_us) return;

	const ownerDocument = container.ownerDocument ?? activeDocument;
	const ownerWindow = (ownerDocument.defaultView ?? activeWindow) as AudioWindow;
	const phoneticContainer = container.createDiv({
		cls: 'dict-phonetic-container',
		attr: {
			role: 'group',
			'aria-label': '发音',
		},
	});

	if (entry.ph_uk) {
		const ukPhoneticBtn = phoneticContainer.createEl('button', {
			cls: 'dict-phonetic-btn',
			text: `英 /${entry.ph_uk}/`,
			attr: {
				type: 'button',
				'aria-label': `播放英式发音：${entry.ph_uk}`,
			},
		});
		if (entry.audio_uk) {
			ukPhoneticBtn.addEventListener('click', () => playAudio(entry.audio_uk, ownerWindow));
		} else {
			ukPhoneticBtn.disabled = true;
			ukPhoneticBtn.setAttribute('aria-label', `英式音标：${entry.ph_uk}，无可用音频`);
		}
	}

	if (entry.ph_us) {
		const usPhoneticBtn = phoneticContainer.createEl('button', {
			cls: 'dict-phonetic-btn',
			text: `美 /${entry.ph_us}/`,
			attr: {
				type: 'button',
				'aria-label': `播放美式发音：${entry.ph_us}`,
			},
		});
		if (entry.audio_us) {
			usPhoneticBtn.addEventListener('click', () => playAudio(entry.audio_us, ownerWindow));
		} else {
			usPhoneticBtn.disabled = true;
			usPhoneticBtn.setAttribute('aria-label', `美式音标：${entry.ph_us}，无可用音频`);
		}
	}
}

function playAudio(audioUrl: string, ownerWindow: AudioWindow): void {
	void new ownerWindow.Audio(audioUrl).play().catch((error: unknown) => {
		console.warn('[LexiBridge] Failed to play pronunciation audio:', error);
	});
}
