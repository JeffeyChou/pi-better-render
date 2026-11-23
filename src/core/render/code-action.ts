import { visibleWidth } from "./util.ts";

const labels = {
	idle: "Copy",
	success: "Copied",
} as const;

export type CopyStatus = keyof typeof labels;

// Keep all states the same size so feedback never moves the hit target.
const labelWidth = Math.max(...Object.values(labels).map(visibleWidth));
export const codeButtonWidth = labelWidth + 2;

export function codeButtonText(status: CopyStatus): string {
	const label = labels[status];
	// Reserve space outside the brackets; the visible button stays compact.
	return " ".repeat(labelWidth - visibleWidth(label)) + `[${label}]`;
}
