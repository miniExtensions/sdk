"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../types");
const SDKLifecycle_1 = require("../lib/SDKLifecycle");
function findPlaceholderLink(doc, href) {
    let result;
    function findLinks(node, pos = 0) {
        if (node.type.name === "text") {
            node.marks.forEach(mark => {
                if (mark.type.name === "link") {
                    if (mark.attrs.href === href) {
                        result = { node, pos };
                        if (result)
                            return false;
                    }
                }
            });
        }
        if (!node.content.size) {
            return;
        }
        node.descendants(findLinks);
    }
    findLinks(doc);
    return result;
}
const createAndInsertLink = async function (view, title, href, options) {
    if (!SDKLifecycle_1.isCurrentView(view)) return;
    const { dispatch, state } = view;
    const { onCreateLink, onShowToast } = options;
    try {
        const url = await onCreateLink(title);
        if (!SDKLifecycle_1.isCurrentView(view)) return;
        const result = findPlaceholderLink(view.state.doc, href);
        if (!result)
            return;
        dispatch(view.state.tr
            .removeMark(result.pos, result.pos + result.node.nodeSize, state.schema.marks.link)
            .addMark(result.pos, result.pos + result.node.nodeSize, state.schema.marks.link.create({ href: url })));
    }
    catch (err) {
        if (!SDKLifecycle_1.isCurrentView(view)) return;
        const result = findPlaceholderLink(view.state.doc, href);
        if (!result)
            return;
        dispatch(view.state.tr.removeMark(result.pos, result.pos + result.node.nodeSize, state.schema.marks.link));
        if (onShowToast) {
            onShowToast(options.dictionary.createLinkError, types_1.ToastType.Error);
        }
    }
};
exports.default = createAndInsertLink;
//# sourceMappingURL=createAndInsertLink.js.map
