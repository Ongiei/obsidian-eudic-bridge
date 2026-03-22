import {noun, verb, adjective} from 'wink-lemmatizer';

export function getNoun(word: string): string {
	return noun(word);
}

export function getVerb(word: string): string {
	return verb(word);
}

export function getAdjective(word: string): string {
	return adjective(word);
}

export function getLemma(word: string): string {
	const nounLemma = noun(word);
	if (nounLemma !== word) return nounLemma;
	
	const verbLemma = verb(word);
	if (verbLemma !== word) return verbLemma;
	
	const adjLemma = adjective(word);
	if (adjLemma !== word) return adjLemma;
	
	return word;
}