'use strict'

exports = module.exports = require('../commonjs/PhoneInputWithCountry.js').default

exports.formatPhoneNumber = require('../commonjs/libphonenumber/formatPhoneNumber.js').default
exports.formatPhoneNumberIntl = require('../commonjs/libphonenumber/formatPhoneNumber.js').formatPhoneNumberIntl

exports.parsePhoneNumber = require("../../libphonenumber-js/core/index.cjs").default
exports.isValidPhoneNumber = require("../../libphonenumber-js/core/index.cjs").isValidPhoneNumber
exports.isPossiblePhoneNumber = require("../../libphonenumber-js/core/index.cjs").isPossiblePhoneNumber
exports.getCountries = require("../../libphonenumber-js/core/index.cjs").getCountries
exports.getCountryCallingCode = require("../../libphonenumber-js/core/index.cjs").getCountryCallingCode
exports.isSupportedCountry = require("../../libphonenumber-js/core/index.cjs").isSupportedCountry

exports['default'] = require('../commonjs/PhoneInputWithCountry.js').default