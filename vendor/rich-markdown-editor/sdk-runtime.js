"use strict";
// Private SDK facade. Public declarations never traverse the upstream type graph.
const engine = require("./dist/index.js");
exports.Editor = engine.default;
exports.theme = engine.theme;
exports.Extension = engine.Extension;
exports.isMarkdown = require("./dist/lib/isMarkdown.js").default;
exports.isUrl = require("./dist/lib/isUrl.js").default;
exports.isInCode = require("./dist/queries/isInCode.js").default;
exports.LANGUAGES = require("./dist/plugins/Prism.js").LANGUAGES;
// Preserve the exact CommonJS constructor graph used by the vendored engine.
const state = require("prosemirror-state");
exports.Plugin = state.Plugin;
exports.PluginKey = state.PluginKey;
exports.TextSelection = state.TextSelection;
exports.toggleMark = require("prosemirror-commands").toggleMark;
exports.isInTable = require("prosemirror-tables").isInTable;
