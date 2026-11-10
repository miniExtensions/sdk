"use strict";
// The SDK imports the real peer through ESM before loading this private graph.
// Return that actual instance: never copy React, import a second copy or use globals.
let peer;
exports.bindReact = function bindReact(namespace) {
  const candidate = namespace && namespace.default &&
    namespace.default.createElement === namespace.createElement
    ? namespace.default : namespace;
  if (!candidate || typeof candidate.createElement !== "function" ||
      typeof candidate.useState !== "function") {
    throw new Error("Phone runtime requires the SDK React peer");
  }
  if (peer) {
    if (peer.createElement !== candidate.createElement ||
        peer.useState !== candidate.useState) {
      throw new Error("Phone runtime cannot replace its React peer");
    }
    return;
  }
  peer = candidate;
};
exports.getReact = function getReact() {
  if (!peer) throw new Error("Phone React peer must be bound before vendor loading");
  return peer;
};
