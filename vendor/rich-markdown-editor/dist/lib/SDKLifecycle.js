"use strict";
// A captured ProseMirror view retains only the mount that allocated it.
exports.isCurrentView = function isCurrentView(view) {
    return Boolean(view && (typeof view.sdkIsCurrent !== "function" || view.sdkIsCurrent()));
};
