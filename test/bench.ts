import { readFileSync } from "node:fs";
import { setCapabilities } from "@earendil-works/pi-tui";
import { createMathRenderer } from "../src/math/formula.ts";
import { setKittyWriter } from "../src/math/kitty.ts";
import { loadMathJaxSync } from "../src/math/mathjax.ts";
import { lex } from "../src/render/lexer.ts";
import { renderMarkdown } from "../src/render/rich-markdown.ts";
import { createStyle } from "../src/style.ts";
import { darkTheme } from "./theme.ts";
loadMathJaxSync(); setKittyWriter(undefined); process.env.PI_BETTER_RENDER_PLACEHOLDERS = "1";
setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
const style = createStyle(darkTheme(), () => undefined);
const math = createMathRenderer(() => style.mathColor);
const base = readFileSync(new URL("./fixtures/perceptron.md", import.meta.url), "utf8");
for (const mult of [1, 4, 16]) {
  const src = Array.from({ length: mult }, (_, i) => base.replaceAll("$", "$").replace("Block 7", `Block ${i}`)).join("\n\n");
  const step = 20; // ~ one delta
  let t0 = performance.now(), frames = 0;
  for (let i = step; i <= src.length; i += step) {
    const s = src.slice(0, i);
    
    renderMarkdown(s, 100, { style, math, streaming: true }); frames++;
  }
  const total = performance.now() - t0;
  // steady-state per frame near the end
  const s = src.slice(0, src.length - 5); let b = performance.now();
  for (let k = 0; k < 50; k++) renderMarkdown(s + "x".repeat(k % 3), 100, { style, math, streaming: true });
  const tail = (performance.now() - b) / 50;
  const lexTail = 0;
  console.log(`${(src.length/1000).toFixed(1)}k chars: avg ${(total/frames).toFixed(2)} ms/frame over ${frames} frames, at end: ${tail.toFixed(2)} ms/frame`);
}
