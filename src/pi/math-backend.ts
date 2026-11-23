/**
 * pi's MathBackend: MathJax from the vendored CommonJS bundle (published
 * package) or node_modules (development checkout), rasterized by resvg-js with
 * the fonts cjk-font.ts picks for \text{…}. Installed on import.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setMathBackend } from "../core/math/mathjax.ts";
import { textFontOptions } from "./cjk-font.ts";

const require = createRequire(import.meta.url);
let Resvg: any;

setMathBackend({
	loadLibrary() {
		const bundle = fileURLToPath(new URL("../../vendor/mathjax.cjs", import.meta.url));
		const library = require(existsSync(bundle) ? bundle : "../core/math/mathjax-lib.cjs");
		Resvg ??= require("@resvg/resvg-js").Resvg;
		return library;
	},
	rasterizeSvg(svg) {
		Resvg ??= require("@resvg/resvg-js").Resvg;
		return new Resvg(svg, {
			font: svg.includes("<text") ? textFontOptions(svg) : { loadSystemFonts: false },
			shapeRendering: 2,
			textRendering: 2,
			logLevel: "error",
		})
			.render()
			.asPng();
	},
});
