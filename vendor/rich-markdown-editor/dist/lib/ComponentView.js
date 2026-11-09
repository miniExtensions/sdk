"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const React = __importStar(require("react"));
const styled_components_1 = require("../../dependencies/styled-components");
const theme_1 = require("../styles/theme");
class ComponentView {
    constructor(component, { editor, extension, node, view, getPos, decorations }) {
        this.isSelected = false;
        this.component = component;
        this.editor = editor;
        this.extension = extension;
        this.getPos = getPos;
        this.decorations = decorations;
        this.node = node;
        this.view = view;
        this.portalKey = {};
        this.destroyed = false;
        this.generation = editor.sdkGeneration;
        this.renderNodeView = editor.props.renderNodeView;
        this.removeNodeView = editor.props.removeNodeView;
        if (typeof this.renderNodeView !== "function" || typeof this.removeNodeView !== "function") {
            throw new Error("The SDK editor requires its React portal owner.");
        }
        this.dom = node.type.spec.inline
            ? document.createElement("span")
            : document.createElement("div");
        editor.sdkNodeViews.add(this);
        this.renderElement();
    }
    renderElement() {
        if (this.destroyed || !this.editor.sdkActive || this.generation !== this.editor.sdkGeneration) return;
        const { dark } = this.editor.props;
        const theme = this.editor.props.theme || (dark ? theme_1.dark : theme_1.light);
        const children = this.component({
            theme,
            node: this.node,
            isSelected: this.isSelected,
            isEditable: this.view.editable,
            getPos: this.getPos,
            isCurrent: () => !this.destroyed && this.editor.sdkActive && this.generation === this.editor.sdkGeneration && this.editor.view === this.view,
        });
        this.renderNodeView(this.portalKey, this.dom, React.createElement(styled_components_1.ThemeProvider, { theme: theme }, children));
    }
    update(node) {
        if (this.destroyed || node.type !== this.node.type) {
            return false;
        }
        this.node = node;
        this.renderElement();
        return true;
    }
    selectNode() {
        if (!this.destroyed && this.view.editable) {
            this.isSelected = true;
            this.renderElement();
        }
    }
    deselectNode() {
        if (!this.destroyed && this.view.editable) {
            this.isSelected = false;
            this.renderElement();
        }
    }
    stopEvent() {
        return true;
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.editor.sdkNodeViews.delete(this);
        this.removeNodeView(this.portalKey);
        this.dom = null;
    }
    ignoreMutation() {
        return true;
    }
}
exports.default = ComponentView;
//# sourceMappingURL=ComponentView.js.map
