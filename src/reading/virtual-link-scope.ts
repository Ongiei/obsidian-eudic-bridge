export interface VirtualLinkContainer {
	contains(node: Node): boolean;
}

export function isForegroundDocument(ownerDocument: Document, foregroundDocument: Document): boolean {
	return ownerDocument === foregroundDocument && ownerDocument.hasFocus();
}

export function isInsideVirtualLinkContainer(
	element: HTMLElement,
	containers: Iterable<VirtualLinkContainer>
): boolean {
	for (const container of containers) {
		if (container.contains(element)) return true;
	}
	return false;
}
