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
Object.defineProperty(exports, "__esModule", { value: true });
const uploadPlaceholder_1 = __importStar(require("../lib/uploadPlaceholder"));
const types_1 = require("../types");
const prosemirror_state_1 = require("prosemirror-state");
let uploadId = 0;
const insertFiles = function (view, event, pos, files, options) {
    // Capture this view, never the editor's replacement view. Every asynchronous
    // boundary retains its mount lease, including host callback re-entry.
    const current = () => typeof view.sdkIsCurrent === "function" && view.sdkIsCurrent();
    if (!current() || typeof view.sdkOnRetire !== "function") return;
    const images = files.filter(file => /image/i.test(file.type));
    if (images.length === 0) return;
    const { dictionary, uploadImage, onImageUploadStart, onImageUploadStop, onShowToast } = options;
    if (!current()) return;
    if (!uploadImage) {
        console.warn("uploadImage callback must be defined to handle image uploads.");
        return;
    }
    let retired = false;
    let complete = 0;
    const preloads = new Set();
    let unregisterRetirement = () => {};
    const isCurrent = () => !retired && current();
    const releaseRetirement = () => {
        if (complete === images.length && preloads.size === 0) unregisterRetirement();
    };
    const retire = () => {
        retired = true;
        for (const image of preloads) {
            image.onload = null;
            image.onerror = null;
        }
        preloads.clear();
    };
    unregisterRetirement = view.sdkOnRetire(retire);
    if (!isCurrent()) return;
    event.preventDefault();
    if (!isCurrent()) return;
    if (onImageUploadStart) onImageUploadStart();
    if (!isCurrent()) return;
    const { schema } = view.state;
    const failed = (error, id) => {
        if (!isCurrent()) return;
        console.error(error);
        if (!isCurrent()) return;
        view.dispatch(view.state.tr.setMeta(uploadPlaceholder_1.default, { remove: { id } }));
        if (isCurrent() && onShowToast) onShowToast(dictionary.imageUploadError, types_1.ToastType.Error);
    };
    for (const file of images) {
        if (!isCurrent()) break;
        const id = `upload-${uploadId++}`;
        const { tr } = view.state;
        tr.setMeta(uploadPlaceholder_1.default, {
            add: { id, file, pos, replaceExisting: options.replaceExisting },
        });
        if (!isCurrent()) break;
        view.dispatch(tr);
        if (!isCurrent()) break;
        let upload;
        try {
            upload = uploadImage(file);
        } catch (error) {
            upload = Promise.reject(error);
        }
        Promise.resolve(upload)
            .then(src => {
                if (!isCurrent()) return;
                const newImg = new Image();
                preloads.add(newImg);
                const settlePreload = () => {
                    if (!preloads.delete(newImg)) return false;
                    newImg.onload = null;
                    newImg.onerror = null;
                    releaseRetirement();
                    return true;
                };
                newImg.onload = () => {
                    if (!settlePreload() || !isCurrent()) return;
                    const result = uploadPlaceholder_1.findPlaceholder(view.state, id);
                    if (result === null) return;
                    const [from, to] = result;
                    view.dispatch(view.state.tr
                        .replaceWith(from, to || from, schema.nodes.image.create({ src }))
                        .setMeta(uploadPlaceholder_1.default, { remove: { id } }));
                    if (!isCurrent()) return;
                    if (view.state.selection.from === from) {
                        view.dispatch(view.state.tr.setSelection(new prosemirror_state_1.NodeSelection(view.state.doc.resolve(from))));
                    }
                };
                newImg.onerror = error => {
                    if (settlePreload()) failed(error, id);
                };
                if (!isCurrent()) {
                    settlePreload();
                    return;
                }
                try {
                    newImg.src = src;
                } catch (error) {
                    settlePreload();
                    throw error;
                }
            })
            .catch(error => failed(error, id))
            .finally(() => {
                complete += 1;
                // This remains tied to upload-promise settlement, not image
                // preloading. A retired mount must not notify its replacement.
                releaseRetirement();
                if (complete === images.length && isCurrent() && onImageUploadStop) onImageUploadStop();
            });
    }
};
exports.default = insertFiles;
//# sourceMappingURL=insertFiles.js.map