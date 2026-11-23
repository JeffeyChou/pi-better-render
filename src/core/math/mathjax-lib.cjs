/**
 * Every MathJax module the renderer uses, as static requires.
 *
 * tools/bundle-mathjax.mjs bundles this file into vendor/mathjax.cjs, so the
 * published package ships only the code that actually runs (instead of
 * ~100 MB of @mathjax packages). Without the bundle (a development checkout)
 * mathjax.ts requires this file directly from node_modules.
 *
 * Font data for less common characters is split into files MathJax loads on
 * demand. The bundle ships them in vendor/newcm-dynamic/, rewritten to use the
 * bundle's font class; they are loaded synchronously.
 */
"use strict";
const path = require("node:path");

/* global __MATHJAX_BUNDLED__ */
const BUNDLED = typeof __MATHJAX_BUNDLED__ !== "undefined" && __MATHJAX_BUNDLED__;

const { mathjax } = require("@mathjax/src/js/mathjax.js");
const { liteAdaptor } = require("@mathjax/src/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("@mathjax/src/js/handlers/html.js");
const { TeX } = require("@mathjax/src/js/input/tex.js");
const { SVG } = require("@mathjax/src/js/output/svg.js");
const newcmSvg = require("@mathjax/mathjax-newcm-font/js/svg.js");
const direction = require("@mathjax/src/js/output/common/Direction.js");

/**
 * TeX packages to load. Left out: html/texhtml (raw HTML/CSS), noerrors/noundefined
 * (would hide errors we want to surface), require/autoload/setoptions (runtime
 * loading and reconfiguration), colorv2/fontsizev3 (v2/v3 compatibility variants).
 */
require("@mathjax/src/js/input/tex/base/BaseConfiguration.js");
require("@mathjax/src/js/input/tex/action/ActionConfiguration.js");
require("@mathjax/src/js/input/tex/ams/AmsConfiguration.js");
require("@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js");
require("@mathjax/src/js/input/tex/bbm/BbmConfiguration.js");
require("@mathjax/src/js/input/tex/bboldx/BboldxConfiguration.js");
require("@mathjax/src/js/input/tex/bbox/BboxConfiguration.js");
require("@mathjax/src/js/input/tex/begingroup/BegingroupConfiguration.js");
require("@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js");
require("@mathjax/src/js/input/tex/braket/BraketConfiguration.js");
require("@mathjax/src/js/input/tex/bussproofs/BussproofsConfiguration.js");
require("@mathjax/src/js/input/tex/cancel/CancelConfiguration.js");
require("@mathjax/src/js/input/tex/cases/CasesConfiguration.js");
require("@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js");
require("@mathjax/src/js/input/tex/color/ColorConfiguration.js");
require("@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js");
require("@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js");
require("@mathjax/src/js/input/tex/dsfont/DsfontConfiguration.js");
require("@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js");
require("@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js");
require("@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js");
require("@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js");
require("@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js");
require("@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js");
require("@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js");
require("@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js");
require("@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js");
require("@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js");
require("@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js");
require("@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js");
require("@mathjax/src/js/input/tex/units/UnitsConfiguration.js");
require("@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js");
require("@mathjax/src/js/input/tex/verb/VerbConfiguration.js");

const packages = [
	"base", "action", "ams", "amscd", "bbm", "bboldx", "bbox", "begingroup", "boldsymbol", "braket",
	"bussproofs", "cancel", "cases", "centernot", "color", "colortbl", "configmacros", "dsfont", "empheq",
	"enclose", "extpfeil", "gensymb", "mathtools", "mhchem", "newcommand", "physics", "tagformat",
	"textcomp", "textmacros", "unicode", "units", "upgreek", "verb",
];

/** Font extensions that some packages need for their glyphs (name → [data, dynamic prefix]). */
const fontExtensions = [
	[require("@mathjax/mathjax-mhchem-font-extension/js/svg.js"), "@mathjax/mathjax-mhchem-font-extension/js/svg/dynamic"],
	[require("@mathjax/mathjax-bbm-font-extension/js/svg.js"), "@mathjax/mathjax-bbm-font-extension/js/svg/dynamic"],
	[require("@mathjax/mathjax-bboldx-font-extension/js/svg.js"), "@mathjax/mathjax-bboldx-font-extension/js/svg/dynamic"],
	[require("@mathjax/mathjax-dsfont-font-extension/js/svg.js"), "@mathjax/mathjax-dsfont-font-extension/js/svg/dynamic"],
];
for (const [mod, prefix] of fontExtensions) newcmSvg.MathJaxNewcmFont.addExtension(Object.values(mod)[0], prefix);

const DYNAMIC = /^@mathjax\/mathjax-newcm-font\/js\/svg\/dynamic\/([\w.-]+?)(?:\.js)?$/;

/** MathJax's on-demand loader: synchronous, from vendor/newcm-dynamic in the bundle. */
function asyncLoad(name) {
	if (!BUNDLED) return require(name);
	const m = DYNAMIC.exec(name);
	if (!m) throw new Error(`MathJax bundle cannot load ${name}`);
	return require(path.join(__dirname, "newcm-dynamic", `${m[1]}.cjs`));
}
mathjax.asyncLoad = asyncLoad;
mathjax.asyncIsSynchronous = true;

module.exports = {
	mathjax,
	liteAdaptor,
	RegisterHTMLHandler,
	TeX,
	SVG,
	MathJaxNewcmFont: newcmSvg.MathJaxNewcmFont,
	packages,
	bundled: BUNDLED,
	/** Module instances the rewritten dynamic font files share with the bundle. */
	shared: { newcmSvg, direction },
};
