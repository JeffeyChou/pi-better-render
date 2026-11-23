/** Base64 of bytes on any host: Node's Buffer when there is one, else plain JS (no btoa needed). */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
	const NodeBuffer = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (NodeBuffer) return NodeBuffer.from(bytes).toString("base64");
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
		out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
	}
	if (i < bytes.length) {
		const rest = bytes.length - i;
		const n = (bytes[i]! << 16) | ((rest > 1 ? bytes[i + 1]! : 0) << 8);
		out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + (rest > 1 ? ALPHABET[(n >> 6) & 63]! : "=") + "=";
	}
	return out;
}
