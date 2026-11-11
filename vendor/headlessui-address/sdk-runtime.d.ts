import type * as React from 'react';
import type { Combobox, Transition } from 'headlessui-address-source';
export function createAddressRuntime(peer: typeof React): { Combobox: typeof Combobox; Transition: typeof Transition };
