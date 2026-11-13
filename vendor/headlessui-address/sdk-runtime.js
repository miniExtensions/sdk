"use strict";
const {bindReact} = require("./react-peer.js");
let runtime;
exports.createAddressRuntime = function createAddressRuntime(React) {
 bindReact(React);
 if (!runtime) runtime = require("./combobox.js");
 return runtime;
};
