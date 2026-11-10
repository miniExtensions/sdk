"use strict";
const bindReact = require("./react-peer.js").bindReact;
let runtime;
exports.createPhoneRuntime = function createPhoneRuntime(React) {
  // Bind before any React-dependent vendor module initializes. Cache only success.
  bindReact(React);
  if (!runtime) {
    const phone = require("./packages/react-phone-number-input/min/index.cjs");
    runtime = { PhoneInput: phone, getCountries: phone.getCountries };
  }
  return runtime;
};
