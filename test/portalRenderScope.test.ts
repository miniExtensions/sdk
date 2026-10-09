import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { loadedForm } from './formsFixtures.js';
import type { PortalCollectionCriteria } from '../src/portals/types.js';
const criteria: PortalCollectionCriteria = {
    selectedCustomViewId: 'view_example',
    searchTerm: '',
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
};
const read = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
function fixture(
    details: 'empty' | 'hidden' | 'visible' | 'null' | 'missing' = 'visible'
) {
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
    const api = portalFixture(async () =>
        portalListPage({
            recordIds: ['record_1'],
            customViewDetailFields:
                details === 'null'
                    ? null
                    : details === 'missing'
                      ? {}
                      : {
                            fld_children:
                                details === 'empty'
                                    ? []
                                    : [
                                          {
                                              fieldId: 'fld_title',
                                              fieldName: 'Title',
                                              titleOverride: '',
                                              isHidden: details === 'hidden',
                                              fieldIsInEditingChildForm: true,
                                              childFormField: null,
                                              miniExtConfig:
                                                  schema.miniExtConfig,
                                          },
                                      ],
                        },
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: [schema.airtableField],
                    recordIdsToAirtableRecords: {
                        record_1: {
                            id: 'record_1',
                            fields: { fld_title: 'Initial' },
                        },
                    },
                },
            },
        })
    );
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage(),
        portalFieldId: 'fld_children',
        criteria,
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    return { api, owner };
}
it('scope borrows owner, performs zero construction I/O, and makes explicit Load available in idle', async () => {
    const { api, owner } = fixture();
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const initial = scope.getSnapshot();
    assert.equal(initial.retired, false);
    assert.equal(api.calls.length, 0);
    assert.equal(await initial.actions.load(read), true);
    const snapshot = scope.getSnapshot();
    assert.equal(snapshot.rows.length, 1);
    const host = snapshot.rows[0].cells[0].host.getSnapshot();
    assert.equal(host.status, 'ready');
    if (host.status === 'ready') {
        assert.equal(host.fields.length, 1);
        assert.equal(host.fields[0].capability.type, 'readonly');
    }
    assert.equal(await initial.actions.load(read), false);
    assert.equal(api.calls.length, 1);
    snapshot.records!.records[0].fields.fld_title = 'Tampered';
    assert.equal(
        scope.getSnapshot().records!.records[0].fields.fld_title,
        'Initial'
    );
    scope.destroy();
    assert.equal(owner.getSnapshot().phase, 'ready');
    assert.equal(scope.getSnapshot().rows.length, 0);
    owner.destroy();
});
it('present-empty accepted projection and hidden details never invoke resolver', async () => {
    for (const details of ['empty', 'hidden'] as const) {
        const { api, owner } = fixture(details);
        await owner.readFirst(owner.getSnapshot().revision, read);
        let resolved = 0;
        const scope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => true,
            configurationRevision: () => 0,
            resolveCell: () => {
                resolved++;
                return null;
            },
        });
        const snapshot = scope.getSnapshot();
        assert.equal(snapshot.records!.detailProjection, 'present');
        assert.equal(snapshot.rows[0].cells.length, 0);
        assert.equal(resolved, 0);
        scope.destroy();
        owner.destroy();
    }
});
it('owner and configuration changes retire captured actions before callback reentry', async () => {
    const { api, owner } = fixture();
    let configuration = 0;
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => configuration,
    });
    await scope.getSnapshot().actions.load(read);
    const previous = scope.getSnapshot();
    assert.equal(
        previous.actions.setCriteria({ ...criteria, searchTerm: 'new' }),
        true
    );
    assert.equal(await previous.actions.load(read), false);
    const next = scope.getSnapshot();
    configuration++;
    assert.equal(await next.actions.load(read), false);
    assert.equal(scope.getSnapshot().retired, true);
    assert.equal(owner.getSnapshot().phase, 'idle');
    scope.destroy();
    owner.destroy();
});
it('resolver replacement is bounded and never resolves fields from the replaced accepted page', async () => {
    const { api, owner } = fixture();
    await owner.readFirst(owner.getSnapshot().revision, read);
    let resolved = 0;
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
        resolveCell: ({ ownerRevision }) => {
            resolved++;
            owner.setCriteria(ownerRevision, {
                ...criteria,
                searchTerm: 'new',
            });
            return null;
        },
    });
    assert.equal(resolved, 1);
    assert.equal(scope.getSnapshot().rows.length, 0);
    assert.equal(scope.getSnapshot().owner.phase, 'idle');
    scope.destroy();
    owner.destroy();
});
it('synchronous destruction publishes terminal state and refuses actions in subscriber callbacks', async () => {
    const { api, owner } = fixture();
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    let armed = false;
    const deliveries: boolean[] = [];
    scope.subscribe((snapshot) => {
        deliveries.push(snapshot.retired);
        if (armed && !snapshot.retired) {
            assert.equal(snapshot.actions.setCriteria(criteria), false);
            scope.destroy();
        }
    });
    armed = true;
    await scope.getSnapshot().actions.load(read);
    assert.equal(deliveries.at(-1), true);
    assert.equal(api.calls.length, 1);
    owner.destroy();
});
it('constructor subscription failure releases acquired hosts without destroying borrowed owner', async () => {
    const { api, owner } = fixture();
    await owner.readFirst(owner.getSnapshot().revision, read);
    const original = owner.subscribe;
    let active = 0,
        calls = 0;
    owner.subscribe = (listener) => {
        if (++calls === 2) throw new Error('subscription failure');
        active++;
        const stop = original(listener);
        return () => {
            active--;
            stop();
        };
    };
    assert.throws(
        () =>
            createPortalRenderScope({
                owner,
                client: api.client,
                isCurrent: () => true,
                configurationRevision: () => 0,
            }),
        /subscription failure/
    );
    assert.equal(active, 0);
    assert.equal(owner.getSnapshot().phase, 'ready');
    owner.subscribe = original;
    owner.destroy();
});

it('explicit accepted cells retain caller draft across remount and eagerly invalidate retained scope actions', async () => {
    const { api, owner } = fixture();
    await owner.readFirst(owner.getSnapshot().revision, read);
    const cell = createPortalCellBinding({
        client: api.client,
        schema: loadedForm().payload.fieldIdsToSchemas.fld_title,
        value: 'Initial',
        input: {
            portalExtensionAccessToken: 'portal_access_example',
            portalFieldId: 'fld_children',
            recordId: 'record_1',
            recordFieldId: 'fld_title',
            selectedCustomViewId: 'view_example',
        },
        getScope: () => ({ ownerId: 'A', revision: 0 }),
        isCurrent: () => true,
        recovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId: 'table_children',
                childExtensionId: '',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    const options = {
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
        resolveCell: () => cell,
    };
    const scope = createPortalRenderScope(options);
    const before = scope.getSnapshot();
    const snapshot = before.rows[0].cells[0].host.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    if (snapshot.status !== 'ready') throw new Error('Expected ready');
    const props = snapshot.fields[0];
    if (props.physicalKind !== 'singleLineText')
        throw new Error('Expected text');
    const capability = props.capability;
    assert.equal(capability.type, 'editable');
    if (capability.type !== 'editable') throw new Error('Expected editable');
    let delivered = before.revision;
    scope.subscribe((next) => {
        delivered = next.revision;
    });
    assert.equal(capability.setValue('Draft').accepted, true);
    assert.ok(delivered > before.revision);
    assert.equal(before.actions.setCriteria(criteria), false);
    scope.destroy();
    assert.equal(cell.binding.getSnapshot().value, 'Draft');
    assert.equal(capability.setValue('Stale').accepted, false);
    const remount = createPortalRenderScope(options);
    const remounted = remount.getSnapshot().rows[0].cells[0].host.getSnapshot();
    if (remounted.status !== 'ready') throw new Error('Expected ready');
    assert.equal(remounted.fields[0].value, 'Draft');
    assert.equal(api.mutations, 0);
    remount.destroy();
    cell.destroy();
    owner.destroy();
});

it('scope preserves owner-authoritative null and missing accepted detail projections', async () => {
    for (const projection of ['null', 'missing'] as const) {
        const { api, owner } = fixture(projection);
        await owner.readFirst(owner.getSnapshot().revision, read);
        const expected = owner.getRecords(owner.getSnapshot().revision);
        const scope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        assert.equal(scope.getSnapshot().records!.detailProjection, projection);
        assert.deepEqual(scope.getSnapshot().records, expected);
        scope.destroy();
        owner.destroy();
    }
});
it('destroying scope from a resolver never resurrects hosts or rows', async () => {
    const { api, owner } = fixture();
    let armed = false;
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
        resolveCell: () => {
            if (armed) scope.destroy();
            return null;
        },
    });
    armed = true;
    await scope.getSnapshot().actions.load(read);
    const snapshot = scope.getSnapshot();
    assert.equal(snapshot.retired, true);
    assert.deepEqual(snapshot.rows, []);
    const revision = snapshot.revision;
    assert.equal(scope.getSnapshot().revision, revision);
    assert.equal(owner.getSnapshot().phase, 'ready');
    owner.destroy();
});

it('later resolver failure releases presentation and publishes terminal state without retiring borrowed owner', async () => {
    const { api, owner } = fixture();
    await owner.readFirst(owner.getSnapshot().revision, read);
    const original = owner.subscribe;
    let active = 0;
    owner.subscribe = (listener) => {
        const stop = original(listener);
        active++;
        return () => {
            active--;
            stop();
        };
    };
    let armed = false;
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
        resolveCell: () => {
            if (armed) throw new Error('later resolver');
            return null;
        },
    });
    const prior = scope.getSnapshot().rows[0].cells[0].host;
    assert.ok(active > 0);
    const delivered: boolean[] = [];
    scope.subscribe((snapshot) => delivered.push(snapshot.retired));
    armed = true;
    assert.equal(await scope.getSnapshot().actions.load(read), true);
    const terminal = scope.getSnapshot();
    assert.equal(terminal.retired, true);
    assert.deepEqual(terminal.rows, []);
    assert.equal(terminal.records, null);
    assert.equal(delivered.at(-1), true);
    assert.equal(prior.getSnapshot().status, 'retired');
    assert.equal(active, 0);
    assert.equal(scope.getSnapshot().revision, terminal.revision);
    assert.equal(api.calls.length, 2);
    assert.equal(api.mutations, 0);
    assert.equal(owner.getSnapshot().phase, 'ready');
    assert.equal(
        owner.setCriteria(owner.getSnapshot().revision, criteria),
        true
    );
    scope.destroy();
    owner.subscribe = original;
    owner.destroy();
});

it('later host subscription failure releases partial resources and leaves borrowed owner usable', async () => {
    const { api, owner } = fixture();
    await owner.readFirst(owner.getSnapshot().revision, read);
    const original = owner.subscribe;
    let active = 0,
        armed = false;
    owner.subscribe = (listener) => {
        if (armed) throw new Error('later host subscription');
        const stop = original(listener);
        active++;
        return () => {
            active--;
            stop();
        };
    };
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const prior = scope.getSnapshot().rows[0].cells[0].host;
    const delivered: boolean[] = [];
    scope.subscribe((snapshot) => delivered.push(snapshot.retired));
    armed = true;
    assert.equal(await scope.getSnapshot().actions.load(read), true);
    const terminal = scope.getSnapshot();
    assert.equal(terminal.retired, true);
    assert.deepEqual(terminal.rows, []);
    assert.equal(terminal.records, null);
    assert.equal(delivered.at(-1), true);
    assert.equal(prior.getSnapshot().status, 'retired');
    assert.equal(active, 0);
    assert.equal(api.calls.length, 2);
    assert.equal(api.mutations, 0);
    assert.equal(owner.getSnapshot().phase, 'ready');
    assert.equal(
        owner.setCriteria(owner.getSnapshot().revision, criteria),
        true
    );
    scope.destroy();
    owner.subscribe = original;
    owner.destroy();
});

it('captured actions recheck scope revision after every reentrant lease callback window', async () => {
    for (const action of ['criteria', 'load'] as const) {
        let injections = 0;
        for (let ordinal = 1; ordinal <= 8; ordinal++) {
            const { api, owner } = fixture();
            await owner.readFirst(owner.getSnapshot().revision, read);
            const cell = createPortalCellBinding({
                client: api.client,
                schema: loadedForm().payload.fieldIdsToSchemas.fld_title,
                value: 'Initial',
                input: {
                    portalExtensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordId: 'record_1',
                    recordFieldId: 'fld_title',
                    selectedCustomViewId: 'view_example',
                },
                getScope: () => ({ ownerId: 'A', revision: 0 }),
                isCurrent: () => true,
                recovery: {
                    journal: new RecoveryJournal(),
                    scope: {
                        owner: 'A',
                        parentFieldId: 'fld_children',
                        tableId: 'table_children',
                        childExtensionId: '',
                        context: 'modal',
                    },
                    loadVersion: 1,
                },
            });
            let armed = false,
                fired = false,
                callbacks = 0,
                delegated = 0;
            const leaseCallback = () => {
                if (!armed || fired || delegated !== 0) return;
                if (++callbacks === ordinal) {
                    fired = true;
                    assert.equal(
                        cell.binding.setValue('Reentrant draft').accepted,
                        true
                    );
                }
            };
            const originalCriteria = owner.setCriteria;
            const originalRead = owner.readFirst;
            owner.setCriteria = (revision, value) => {
                delegated++;
                return originalCriteria(revision, value);
            };
            owner.readFirst = (revision, options) => {
                delegated++;
                return originalRead(revision, options);
            };
            const scope = createPortalRenderScope({
                owner,
                client: api.client,
                isCurrent: () => {
                    leaseCallback();
                    return true;
                },
                configurationRevision: () => {
                    leaseCallback();
                    return 0;
                },
                resolveCell: () => cell,
            });
            const captured = scope.getSnapshot();
            const ownerRevision = owner.getSnapshot().revision;
            armed = true;
            const accepted =
                action === 'criteria'
                    ? captured.actions.setCriteria({
                          ...criteria,
                          searchTerm: 'Delegated change',
                      })
                    : await captured.actions.load(read);
            armed = false;
            if (fired) {
                injections++;
                assert.equal(accepted, false, `${action} callback ${ordinal}`);
                assert.equal(
                    delegated,
                    0,
                    `${action} callback ${ordinal} delegated`
                );
                assert.equal(owner.getSnapshot().revision, ownerRevision);
                assert.equal(owner.getSnapshot().criteria!.searchTerm, '');
                assert.equal(api.calls.length, 1);
                assert.equal(api.mutations, 0);
                assert.ok(scope.getSnapshot().revision > captured.revision);
            }
            scope.destroy();
            cell.destroy();
            owner.destroy();
        }
        assert.ok(
            injections >= 3,
            `${action} exercised multiple lease callback boundaries`
        );
    }
});
