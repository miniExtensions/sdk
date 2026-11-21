import {
    createNativePortalCollectionKernel,
    runNativePortalCollectionRead,
    type NativePortalCollectionHostPort,
    type NativePortalCollectionKernel,
} from '../src/portals/index.js';

type Row = { id: string; title: string };
type Schema = { id: string };
type Detail = { fieldId: string };
type Projection = { refreshed: boolean };

// Enumerate the original contract so newly required methods cannot silently
// change what the external caller is expected to implement.
type CustomReadKernel = Pick<
    NativePortalCollectionKernel<Row, Schema, Detail, Projection>,
    | 'createState'
    | 'observe'
    | 'begin'
    | 'isCurrent'
    | 'succeed'
    | 'fail'
    | 'cleanup'
    | 'isCleanupCurrent'
    | 'completeCleanup'
    | 'retire'
>;

// Compile-only public consumer, included by tsconfig.test.json.
export function nativePortalCollectionPublicCompatibility(
    customKernel: CustomReadKernel,
    host: NativePortalCollectionHostPort<Row, Schema, Detail, Projection>
) {
    const reading = runNativePortalCollectionRead(customKernel, host, {
        requestId: 'custom-read',
        mode: 'reload',
    });
    const kernel = createNativePortalCollectionKernel<
        Row,
        Schema,
        Detail,
        Projection
    >();
    const state = host.snapshot();
    const { frame, scope } = state;
    return {
        reading,
        afterRemoval: frame
            ? kernel.removeAcknowledgedRecord(state, {
                  scope,
                  frame,
                  recordId: 'acknowledged-deleted-record',
              })
            : state,
    };
}
