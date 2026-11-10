import * as React from 'react';
import { createPhoneRuntime } from '../../vendor/phone-number-input/sdk-runtime.js';

const runtime = createPhoneRuntime(React);
export const PhoneInput = runtime.PhoneInput;
export const getCountries = runtime.getCountries;
export type { PhoneVendorProps } from '../../vendor/phone-number-input/sdk-runtime.js';
