import {requestUrl} from 'obsidian';
import {DictEntry} from './types';

const ALLOWED_AUDIO_DOMAINS = ['dict.youdao.com'];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function asItems(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	return value === null || value === undefined ? [] : [value];
}

function readText(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const text = readText(item);
			if (text) {
				return text;
			}
		}
		return '';
	}

	const record = asRecord(value);
	if (!record) {
		return '';
	}

	for (const key of ['i', 'value', 'text', 'l']) {
		const text = readText(record[key]);
		if (text) {
			return text;
		}
	}
	return '';
}

function readTextList(value: unknown): string[] {
	const values = asItems(value)
		.map(item => readText(item))
		.filter((item): item is string => Boolean(item));
	return [...new Set(values)];
}

function validateAudioUrl(url: string): string {
	if (!url) return '';
	try {
		const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
		if (!ALLOWED_AUDIO_DOMAINS.some(domain =>
			urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
		)) {
			return '';
		}
		return url;
	} catch {
		return '';
	}
}

export class YoudaoRequestError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
		this.name = 'YoudaoRequestError';
	}
}

export class YoudaoService {
	private static readonly BASE_URL = 'https://dict.youdao.com/jsonapi';

	static async lookup(word: string): Promise<DictEntry | null> {
		const url = `${this.BASE_URL}?q=${encodeURIComponent(word)}`;
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			},
			throw: false,
		});

		if (response.status !== 200) {
			throw new YoudaoRequestError(`有道词典请求失败：服务器返回 ${response.status}`, response.status);
		}

		return parseYoudaoResponse(response.json, word);
	}
}

export function parseYoudaoResponse(data: unknown, originalWord: string): DictEntry | null {
	const root = asRecord(data);
	const ec = asRecord(root?.ec);
	const entryData = asRecord(asItems(ec?.word)[0]);
	if (!ec || !entryData) {
		return null;
	}

	const ph_uk = readText(entryData.ukphone);
	const ph_us = readText(entryData.usphone);

	let audio_uk = '';
	let audio_us = '';
	const ukSpeech = readText(entryData.ukspeech);
	const usSpeech = readText(entryData.usspeech);
	if (ukSpeech) {
		const rawUrl = ukSpeech.startsWith('http')
			? ukSpeech
			: `https://dict.youdao.com/dictvoice?audio=${ukSpeech}`;
		audio_uk = validateAudioUrl(rawUrl);
	}
	if (usSpeech) {
		const rawUrl = usSpeech.startsWith('http')
			? usSpeech
			: `https://dict.youdao.com/dictvoice?audio=${usSpeech}`;
		audio_us = validateAudioUrl(rawUrl);
	}

	const definitions: { pos: string; trans: string }[] = [];
	for (const definitionGroup of asItems(entryData.trs)) {
		const group = asRecord(definitionGroup);
		const definition = asRecord(asItems(group?.tr)[0]);
		const definitionBody = asRecord(definition?.l);
		let trans = readText(definitionBody?.i);
		if (!trans) {
			continue;
		}

		let pos = readText(definition?.pos);
		if (!pos) {
			const posMatch = trans.match(/^([a-z]+\.\s+)/i);
			if (posMatch?.[1]) {
				pos = posMatch[1].trim();
				trans = trans.substring(posMatch[0].length);
			}
		}
		definitions.push({pos, trans});
	}

	const tags = readTextList(ec.exam_type);

	const exchange: { name: string; value: string }[] = [];
	for (const rawForm of asItems(entryData.wfs)) {
		const formContainer = asRecord(rawForm);
		const form = asRecord(formContainer?.wf);
		const name = readText(form?.name);
		const value = readText(form?.value);
		if (name && value) {
			exchange.push({name, value});
		}
	}

	const entry: DictEntry = {
		word: readText(entryData['return-phrase']) || originalWord,
		ph_uk,
		ph_us,
		audio_uk,
		audio_us,
		definitions,
		tags,
		exchange
	};

	const webTransContainer = asRecord(root?.web_trans);
	const webTransRaw = asItems(webTransContainer?.['web-translation']);
	if (webTransRaw.length > 0) {
		const queryLower = originalWord.toLowerCase().trim();
		const webTrans: { key: string; value: string[] }[] = [];
		for (const rawItem of webTransRaw) {
			const item = asRecord(rawItem);
			if (!item) continue;
			const key = readText(item['@key']) || readText(item.key);
			const values: string[] = [];
			for (const rawTranslation of asItems(item.trans)) {
				const translation = asRecord(rawTranslation);
				const value = readText(translation?.value);
				if (value) {
					values.push(value);
				}
			}
			if (key.toLowerCase().trim() === queryLower && values.length > 0) {
				webTrans.push({key, value: [...new Set(values)]});
			}
		}
		if (webTrans.length > 0) {
			entry.webTrans = webTrans;
		}
	}

	const bilingualContainer = asRecord(root?.blng_sents_part);
	const bilingualRaw = asItems(bilingualContainer?.['sentence-pair']);
	if (bilingualRaw.length > 0) {
		const examples: { eng: string; chn: string }[] = [];
		for (let i = 0; i < Math.min(bilingualRaw.length, 5); i++) {
			const item = asRecord(bilingualRaw[i]);
			if (!item) continue;
			const eng = readText(item.sentence);
			const chn = readText(item['sentence-translation']);
			if (eng && chn) {
				examples.push({eng, chn});
			}
		}
		if (examples.length > 0) {
			entry.bilingualExamples = examples;
		}
	}

	if (definitions.length > 0 || ph_uk || ph_us) {
		return entry;
	}

	return null;
}
