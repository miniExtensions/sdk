import type {
    FormLoadedResult,
    LoadExtensionResult,
    LoginPageResult,
    PasswordRequiredResult,
    PortalLoadedResult,
} from '../src/runtime/index.js';

// Compile-only public witnesses, included by tsconfig.test.json. These functions
// are never invoked; source selection remains the server's responsibility.
type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <
        Value,
    >() => Value extends Right ? 1 : 2
        ? true
        : false;
type Assert<Value extends true> = Value;
type AirtableSource = { type: 'airtable'; baseId: string };
type TableSource = { type: 'table'; tableExtensionId: string };
type ExpectedSource = AirtableSource | TableSource;
type Source = NonNullable<FormLoadedResult['source']>;

type ScreenEnvelopes = {
    form: FormLoadedResult;
    portal: PortalLoadedResult;
    login: LoginPageResult;
    password: PasswordRequiredResult;
};
type EveryScreen<Value> = { [Screen in keyof ScreenEnvelopes]: Value };
type AcceptedVariants<Envelope> = [
    Omit<Envelope, 'source'> extends Envelope ? true : false,
    Omit<Envelope, 'source'> & { source: AirtableSource } extends Envelope
        ? true
        : false,
    Omit<Envelope, 'source'> & { source: TableSource } extends Envelope
        ? true
        : false,
];

// All four screen aliases must retain the finite source union, the string
// compatibility baseId, and both explicit sources plus legacy source omission.
export type SourceEnvelopeContracts = [
    Assert<
        Equal<
            {
                [Screen in keyof ScreenEnvelopes]: NonNullable<
                    ScreenEnvelopes[Screen]['source']
                >;
            },
            EveryScreen<ExpectedSource>
        >
    >,
    Assert<
        Equal<
            {
                [Screen in keyof ScreenEnvelopes]: ScreenEnvelopes[Screen]['payload']['baseId'];
            },
            EveryScreen<string>
        >
    >,
    Assert<
        Equal<
            {
                [Screen in keyof ScreenEnvelopes]: AcceptedVariants<
                    ScreenEnvelopes[Screen]
                >;
            },
            EveryScreen<[true, true, true]>
        >
    >,
];

export function acceptedSourceEnvelopes(
    form: Omit<FormLoadedResult, 'source'>
) {
    const legacy: FormLoadedResult = form;
    const airtable: FormLoadedResult = {
        ...form,
        source: { type: 'airtable', baseId: 'app_example' },
    };
    const table: FormLoadedResult = {
        ...form,
        source: { type: 'table', tableExtensionId: 'table_extension' },
        payload: { ...form.payload, baseId: 'native:workspace_example' },
    };
    const loads: LoadExtensionResult[] = [legacy, airtable, table];
    return loads;
}

export function rejectedSourceVariants(form: Omit<FormLoadedResult, 'source'>) {
    // @ts-expect-error Table sources require their table extension identity.
    const missingTable: Source = { type: 'table' };
    // @ts-expect-error Airtable sources require their Airtable base identity.
    const missingAirtable: Source = { type: 'airtable' };
    const crossedTable: Source = {
        type: 'table',
        // @ts-expect-error An Airtable base cannot replace a Table extension ID.
        baseId: 'app_example',
    };
    const crossedAirtable: Source = {
        type: 'airtable',
        // @ts-expect-error A Table extension cannot replace an Airtable base ID.
        tableExtensionId: 'table_extension',
    };
    const mixedTable: Source = {
        type: 'table',
        tableExtensionId: 'table_extension',
        // @ts-expect-error Fresh Table sources cannot mix source identities.
        baseId: 'app_example',
    };
    const mixedAirtable: Source = {
        type: 'airtable',
        baseId: 'app_example',
        // @ts-expect-error Fresh Airtable sources cannot mix source identities.
        tableExtensionId: 'table_extension',
    };
    const numericBase: Source = {
        type: 'airtable',
        // @ts-expect-error The Airtable source base ID remains a string.
        baseId: 42,
    };
    const numericTable: Source = {
        type: 'table',
        // @ts-expect-error The Table extension ID remains a string.
        tableExtensionId: 42,
    };
    const unknownSource: Source = {
        // @ts-expect-error Source kinds remain a closed discriminator union.
        type: 'external',
        baseId: 'app_example',
    };

    const invalidTablePayload: FormLoadedResult = {
        ...form,
        source: { type: 'table', tableExtensionId: 'table_extension' },
        payload: {
            ...form.payload,
            // @ts-expect-error Table payloads retain the legacy string baseId.
            baseId: 42,
        },
    };
    return {
        missingTable,
        missingAirtable,
        crossedTable,
        crossedAirtable,
        mixedTable,
        mixedAirtable,
        numericBase,
        numericTable,
        unknownSource,
        invalidTablePayload,
    };
}

export function narrowSourceEnvelope(
    envelope: ScreenEnvelopes[keyof ScreenEnvelopes]
) {
    const compatibilityBaseId: string = envelope.payload.baseId;
    const source = envelope.source;
    if (source?.type === 'table') {
        const tableExtensionId: string = source.tableExtensionId;
        // @ts-expect-error The Table source does not expose an Airtable base ID.
        source.baseId;
        return { compatibilityBaseId, tableExtensionId };
    }
    if (source?.type === 'airtable') {
        const baseId: string = source.baseId;
        // @ts-expect-error The Airtable source does not expose a Table identity.
        source.tableExtensionId;
        return { compatibilityBaseId, baseId };
    }
    const legacySource: undefined = source;
    return { compatibilityBaseId, legacySource };
}
