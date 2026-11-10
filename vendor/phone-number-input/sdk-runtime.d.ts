import type * as React from 'react';

export type PhoneChangeKind = 'country' | 'input';
export type PhoneChangeTransaction = {
    /** Immutable flag for the original detached/unmount action. */
    detached: boolean;
    /** Sole canonical output; caller enforces original lease/current authority/once. */
    deliver(value: string | undefined): void;
};
export type PhoneReplayInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    /** Capture while the actual input ref is alive; replay uses that original node. */
    sdkCapturePhoneReplay?: () => () => void;
};

/** Private vendor boundary. Public complete-field props remain SDK-owned. */
export type PhoneVendorProps = Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'ref'
> & {
    value?: string;
    onChange(value: string | undefined): void;
    defaultCountry?: string;
    international?: boolean;
    inputComponent?: React.ElementType;
    inputRef?: React.Ref<HTMLInputElement>;
    sdkCapturePhoneChange?(kind: PhoneChangeKind): PhoneChangeTransaction;
    numberInputProps?: React.InputHTMLAttributes<HTMLInputElement> & {
        sdkEnableReplay?: boolean;
    };
    countrySelectProps?: {
        arrowComponent?: React.ElementType;
        unicodeFlags?: boolean;
    };
};
export type PhoneRuntime = {
    PhoneInput: React.ForwardRefExoticComponent<
        PhoneVendorProps & React.RefAttributes<HTMLInputElement>
    >;
    getCountries(): string[];
};
/** Private producer boundary: bind the SDK's real peer before vendor initialization. */
export function createPhoneRuntime(peer: typeof React): PhoneRuntime;
