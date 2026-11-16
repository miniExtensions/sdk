import type {
    PostgresFormRecordAccess,
    PostgresRowObservation,
} from '../src/runtime/index.js';
import type { CanonicalPostgresFormRecordAccess } from '../src/runtime/contracts/postgres.generated.js';

declare const identifier: PostgresRowObservation['identifier'];
declare const canonical: CanonicalPostgresFormRecordAccess;
declare const portable: PostgresFormRecordAccess;
const fromCanonical: PostgresFormRecordAccess = canonical;
const fromPortable: CanonicalPostgresFormRecordAccess = portable;
const editing: PostgresFormRecordAccess = {
    disableCreatingRecords: true,
    disableAccessingExistingRecords: false,
    identifier,
};
const disabled: PostgresFormRecordAccess = {
    disableAccessingExistingRecords: true,
};
const retained: PostgresFormRecordAccess = {
    disableAccessingExistingRecords: true,
    identifier,
};
// @ts-expect-error A present access object must make a deliberate editing choice.
const unspecified: PostgresFormRecordAccess = {};
// @ts-expect-error Editing requires an explicit saved identifier.
const missingIdentifier: PostgresFormRecordAccess = {
    disableAccessingExistingRecords: false,
};
const invalidFlag: PostgresFormRecordAccess = {
    // @ts-expect-error Native access uses the existing inverse Boolean setting.
    disableAccessingExistingRecords: 'false',
    identifier,
};
// @ts-expect-error Absence belongs to the containing Form access property, not this type.
const absent: PostgresFormRecordAccess = undefined;
function inspectAccess(access: PostgresFormRecordAccess) {
    if (access.disableAccessingExistingRecords === false) {
        const required: PostgresRowObservation['identifier'] =
            access.identifier;
        return required.configuration;
    }
    return access.identifier?.configuration;
}
void [
    fromCanonical,
    fromPortable,
    editing,
    disabled,
    retained,
    unspecified,
    missingIdentifier,
    invalidFlag,
    absent,
    inspectAccess,
];
