import {requestUrl} from 'obsidian';

// 有道词典API响应接口
interface YoudaoJsonResponse {
	ec?: {
		word?: {
			usphone?: string;  // 美式音标
			ukphone?: string;  // 英式音标
			usspeech?: string; // 美式发音URL
			ukspeech?: string; // 英式发音URL
			trs?: {
				tr?: {
					pos?: string;  // 词性
					l?: {
						i?: string[];  // 释义
					};
				}[];
			}[];
			wfs?: {
				wf?: {
					name: string;  // 词形变化名称
					value: string; // 词形变化值
				};
			}[];
		}[];
		exam_type?: string[];  // 考试标签
	};
}

// 词典条目接口
interface DictEntry {
	word: string;  // 单词
	ph_en: string;  // 英式音标
	ph_am: string;  // 美式音标
	mp3_en: string;  // 英式发音URL
	mp3_am: string;  // 美式发音URL
	definitions: { pos: string; trans: string }[];  // 释义列表
	tags: string[];  // 标签
	exchange: { name: string; value: string }[];  // 词形变化
}

// 有道词典服务类
export class YoudaoService {
	private static readonly BASE_URL = 'https://dict.youdao.com/jsonapi';

	// 查询单词
	static async lookup(word: string): Promise<DictEntry | null> {
		try {
			const url = `${this.BASE_URL}?q=${encodeURIComponent(word)}`;
			const response = await requestUrl({
				url: url,
				method: 'GET',
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				}
			});

			if (response.status !== 200) {
				console.error('YoudaoService: HTTP error', response.status);
				return null;
			}

			const data = response.json as YoudaoJsonResponse;
			return this.parseJson(data, word);
		} catch (error) {
			console.error('Youdao JSON API Error:', error);
			return null;
		}
	}

	// 解析JSON响应数据
	private static parseJson(data: YoudaoJsonResponse, originalWord: string): DictEntry | null {
		if (!data.ec || !data.ec.word || data.ec.word.length === 0) {
			return null;
		}

		const entryData = data.ec.word[0];
		if (!entryData) {
			return null;
		}

		// 获取音标
		const ph_en = entryData.ukphone || "";
		const ph_am = entryData.usphone || "";

		// 获取发音URL
		let mp3_en = "";
		let mp3_am = "";
		if (entryData.ukspeech) {
			mp3_en = entryData.ukspeech.startsWith('http') 
				? entryData.ukspeech 
				: `http://dict.youdao.com/dictvoice?audio=${entryData.ukspeech}`;
		}
		if (entryData.usspeech) {
			mp3_am = entryData.usspeech.startsWith('http') 
				? entryData.usspeech 
				: `http://dict.youdao.com/dictvoice?audio=${entryData.usspeech}`;
		}

		// 解析释义
		const definitions: { pos: string; trans: string }[] = [];
		if (entryData.trs) {
			entryData.trs.forEach(tr => {
				if (tr.tr && tr.tr[0] && tr.tr[0].l && tr.tr[0].l.i && tr.tr[0].l.i[0]) {
					let pos = tr.tr[0].pos || "";
					let trans = tr.tr[0].l.i[0];

					// 如果没有词性，尝试从释义中提取
					if (!pos) {
						const posMatch = trans.match(/^([a-z]+\.\s+)/i);
						if (posMatch && posMatch[1]) {
							pos = posMatch[1].trim();
							trans = trans.substring(posMatch[0].length);
						}
					}

					definitions.push({ pos, trans });
				}
			});
		}

		// 获取标签
		const tags = data.ec.exam_type || [];

		// 解析词形变化
		const exchange: { name: string; value: string }[] = [];
		if (entryData.wfs) {
			entryData.wfs.forEach(item => {
				if (item.wf) {
					exchange.push({
						name: item.wf.name,
						value: item.wf.value
					});
				}
			});
		}

		// 构建词典条目
		const entry: DictEntry = {
			word: originalWord,
			ph_en,
			ph_am,
			mp3_en,
			mp3_am,
			definitions,
			tags,
			exchange
		};

		// 至少有释义或音标才返回
		if (definitions.length > 0 || ph_en || ph_am) {
			return entry;
		}

		return null;
	}
}
