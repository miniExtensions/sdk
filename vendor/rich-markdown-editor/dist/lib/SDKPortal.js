"use strict";

// SDK-owned React 18/19 portal. Its detached target exists before child effects;
// only committed lifecycles may attach it to the document.
const React = require("react");
const { createPortal } = require("react-dom");
const useCommitEffect = typeof window === "undefined"
    ? React.useEffect
    : React.useLayoutEffect;

function Portal({ children, node }) {
    const [ownedNode] = React.useState(() =>
        typeof document === "undefined" ? null : document.createElement("div")
    );
    useCommitEffect(() => {
        if (node || !ownedNode) return;
        const parent = ownedNode.ownerDocument.body;
        if (!parent) return;
        if (!ownedNode.parentNode) parent.appendChild(ownedNode);
        return () => {
            // Supplied nodes and nodes moved by another owner are never removed.
            if (ownedNode.parentNode === parent) parent.removeChild(ownedNode);
        };
    }, [node, ownedNode]);
    if (typeof document === "undefined") return null;
    const target = node || ownedNode;
    return target ? createPortal(children, target) : null;
}

exports.Portal = Portal;
