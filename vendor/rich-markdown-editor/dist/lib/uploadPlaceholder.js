"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPlaceholder = void 0;
const prosemirror_state_1 = require("prosemirror-state");
const prosemirror_view_1 = require("prosemirror-view");
const uploadPlaceholder = new prosemirror_state_1.Plugin({
    state: {
        init() {
            return prosemirror_view_1.DecorationSet.empty;
        },
        apply(tr, set) {
            var _a;
            set = set.map(tr.mapping, tr.doc);
            const action = tr.getMeta(this);
            if (action === null || action === void 0 ? void 0 : action.add) {
                if (action.add.replaceExisting) {
                    const $pos = tr.doc.resolve(action.add.pos);
                    if (((_a = $pos.nodeAfter) === null || _a === void 0 ? void 0 : _a.type.name) === "image") {
                        const deco = prosemirror_view_1.Decoration.node($pos.pos, $pos.pos + $pos.nodeAfter.nodeSize, {
                            class: "image-replacement-uploading",
                        }, {
                            id: action.add.id,
                        });
                        set = set.add(tr.doc, [deco]);
                    }
                }
                else {
                    const file = action.add.file;
                    // Allocate only for a rendered widget. A removed/unrendered
                    // state must not retain an object URL with no DOM owner.
                    const ownedUrls = new WeakMap();
                    const deco = prosemirror_view_1.Decoration.widget(action.add.pos, view => {
                        const doc = view.dom.ownerDocument;
                        const element = doc.createElement("div");
                        element.className = "image placeholder";
                        const img = doc.createElement("img");
                        const api = doc.defaultView ? doc.defaultView.URL : URL;
                        const url = api.createObjectURL(file);
                        try {
                            img.src = url;
                            element.appendChild(img);
                            ownedUrls.set(element, { api, url });
                            return element;
                        } catch (error) {
                            api.revokeObjectURL(url);
                            throw error;
                        }
                    }, {
                        id: action.add.id,
                        destroy(element) {
                            const owned = ownedUrls.get(element);
                            if (!owned) return;
                            ownedUrls.delete(element);
                            owned.api.revokeObjectURL(owned.url);
                        },
                    });
                    set = set.add(tr.doc, [deco]);
                }
            }
            if (action === null || action === void 0 ? void 0 : action.remove) {
                set = set.remove(set.find(null, null, spec => spec.id === action.remove.id));
            }
            return set;
        },
    },
    props: {
        decorations(state) {
            return this.getState(state);
        },
    },
});
exports.default = uploadPlaceholder;
function findPlaceholder(state, id) {
    const decos = uploadPlaceholder.getState(state);
    const found = decos.find(null, null, spec => spec.id === id);
    return found.length ? [found[0].from, found[0].to] : null;
}
exports.findPlaceholder = findPlaceholder;
//# sourceMappingURL=uploadPlaceholder.js.map