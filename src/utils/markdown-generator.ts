import { stringifyYaml } from 'obsidian';
import { DictEntry } from '../types';

export interface MarkdownGenerateOptions {
	saveTags: boolean;
	dictSource?: 'youdao' | 'eudic';
	originalWord?: string;
}

export class MarkdownGenerator {
	static generate(word: string, entry: DictEntry, options: MarkdownGenerateOptions): string {
		const tags = new Set<string>(['vocabulary']);

		if (options.saveTags && entry.tags.length > 0) {
			for (const tag of entry.tags) {
				tags.add(`exam/${tag}`);
			}
		}

		for (const def of entry.definitions) {
			if (def.pos) {
				const posTag = def.pos.replace(/\./g, '');
				tags.add(`pos/${posTag}`);
			}
		}

		const uniqueTags = Array.from(tags);

		const aliases: string[] = [];
		for (const item of entry.exchange) {
			aliases.push(item.value);
		}

		if (options.originalWord && options.originalWord.toLowerCase() !== word.toLowerCase()) {
			aliases.push(options.originalWord);
		}

		const uniqueAliases = [...new Set(aliases)].filter(a => a && a.trim() !== '');

		const frontmatter: Record<string, unknown> = {
			tags: uniqueTags,
		};

		if (options.dictSource) {
			frontmatter.dict_source = options.dictSource;
		}

		if (uniqueAliases.length > 0) {
			frontmatter.aliases = uniqueAliases;
		}

		let content = `---\n${stringifyYaml(frontmatter)}---\n\n`;
		content += `# ${word}\n\n`;

		if (entry.ph_uk || entry.ph_us) {
			content += `## 发音\n\n`;
			if (entry.ph_uk) {
				content += `- 英: \`/${entry.ph_uk}/\`\n`;
			}
			if (entry.ph_us) {
				content += `- 美: \`/${entry.ph_us}/\`\n`;
			}
			content += '\n';
		}

		if (entry.definitions.length > 0) {
			content += `## 释义\n\n`;
			for (const def of entry.definitions) {
				const escapedTrans = def.trans.replace(/\[/g, '\\[');
				if (def.pos) {
					content += `- ***${def.pos}*** ${escapedTrans}\n`;
				} else {
					content += `- ${escapedTrans}\n`;
				}
			}
			content += '\n';
		}

		if (entry.webTrans && entry.webTrans.length > 0) {
			content += `## 网络翻译\n\n`;
			for (const item of entry.webTrans) {
				const numberedValues = item.value.map((v, i) => `${i + 1}. ${v}`).join(' ');
				content += `- **${item.key}**: ${numberedValues}\n`;
			}
			content += '\n';
		}

		if (entry.bilingualExamples && entry.bilingualExamples.length > 0) {
			content += `## 例句\n\n`;
			for (const example of entry.bilingualExamples) {
				content += `- ${example.eng}\n`;
				content += `  - ${example.chn}\n`;
			}
			content += '\n';
		}

		if (entry.exchange.length > 0) {
			content += `## 词形变化\n\n`;
			for (const item of entry.exchange) {
				content += `- ${item.name}: ${item.value}\n`;
			}
			content += '\n';
		}

		return content;
	}
}