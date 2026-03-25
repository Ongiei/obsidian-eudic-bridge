import { DictEntry } from '../types';

export function renderPhoneticButtons(container: HTMLElement, entry: DictEntry): void {
	if (!entry.ph_uk && !entry.ph_us) return;

	const phoneticContainer = document.createElement('div');
	phoneticContainer.className = 'dict-phonetic-container';

	if (entry.ph_uk) {
		const ukPhoneticBtn = document.createElement('div');
		ukPhoneticBtn.className = 'dict-phonetic-btn';
		ukPhoneticBtn.textContent = `英 /${entry.ph_uk}/`;
		if (entry.audio_uk) {
			const audioUrl = entry.audio_uk;
			ukPhoneticBtn.addEventListener('click', () => {
				void new Audio(audioUrl).play();
			});
		}
		phoneticContainer.appendChild(ukPhoneticBtn);
	}

	if (entry.ph_us) {
		const usPhoneticBtn = document.createElement('div');
		usPhoneticBtn.className = 'dict-phonetic-btn';
		usPhoneticBtn.textContent = `美 /${entry.ph_us}/`;
		if (entry.audio_us) {
			const audioUrl = entry.audio_us;
			usPhoneticBtn.addEventListener('click', () => {
				void new Audio(audioUrl).play();
			});
		}
		phoneticContainer.appendChild(usPhoneticBtn);
	}

	container.appendChild(phoneticContainer);
}