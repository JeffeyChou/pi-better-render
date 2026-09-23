import type { ThemeLike } from "../src/style.ts";

/** pi's built-in dark theme colors, for rendering outside pi. */
const FG: Record<string, string> = {
	accent: "#8abeb7",
	muted: "#808080",
	dim: "#666666",
	text: "#d4d4d4",
	success: "#b5bd68",
	warning: "#ffff00",
	error: "#cc6666",
	mdHeading: "#f0c674",
	mdLink: "#81a2be",
	mdLinkUrl: "#666666",
	mdCode: "#8abeb7",
	mdCodeBlock: "#b5bd68",
	mdCodeBlockBorder: "#808080",
	mdQuote: "#808080",
	mdQuoteBorder: "#808080",
	mdHr: "#808080",
	mdListBullet: "#8abeb7",
};
const BG: Record<string, string> = { toolPendingBg: "#282832", selectedBg: "#3a3a4a" };

function rgb(hex: string): string {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";");
}

export function darkTheme(): ThemeLike {
	return {
		name: "dark",
		fg: (color, text) => `\x1b[38;2;${rgb(FG[color] ?? FG.text!)}m${text}\x1b[39m`,
		bold: (t) => `\x1b[1m${t}\x1b[22m`,
		italic: (t) => `\x1b[3m${t}\x1b[23m`,
		underline: (t) => `\x1b[4m${t}\x1b[24m`,
		strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
		getFgAnsi: (color) => `\x1b[38;2;${rgb(FG[color] ?? FG.text!)}m`,
		getBgAnsi: (color) => `\x1b[48;2;${rgb(BG[color] ?? "#000000")}m`,
	};
}
