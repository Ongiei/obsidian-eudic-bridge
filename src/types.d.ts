declare module 'wink-lemmatizer' {
	const winkLemmatizer: {
		noun(word: string): string;
		verb(word: string): string;
		adjective(word: string): string;
	};
	export default winkLemmatizer;
}
