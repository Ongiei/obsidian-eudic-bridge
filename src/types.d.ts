declare module 'wink-lemmatizer' {
	export function noun(word: string): string;
	export function verb(word: string): string;
	export function adjective(word: string): string;
}

export interface DictEntry {
	word: string;
	ph_uk: string;
	ph_us: string;
	audio_uk: string;
	audio_us: string;
	definitions: { pos: string; trans: string }[];
	tags: string[];
	exchange: { name: string; value: string }[];
	webTrans?: { key: string; value: string[] }[];
	bilingualExamples?: { eng: string; chn: string }[];
}

export interface EditorWithCM {
	cm: {
		coordsAtPos(pos: number): { top: number; left: number; bottom: number; height: number; right: number } | null;
	};
}