/** Harness-only transport supplement. Never imports SDK source or edits app controls. */
export const cascadeModes = [
    'interrupted-prefill',
    'search-failure',
    'owner-replacement',
];

export function createCascadeFixture(base, mode) {
    if (
        !cascadeModes.includes(mode) ||
        base.state.scenario !== 'linked-filters'
    )
        throw new Error('Unsupported cascade supplement scope.');
    let intercepted = false;
    let pending = null;
    const state = base.state;
    const settle = (outcome) => {
        if (!pending) return;
        const held = pending;
        pending = null;
        state.events.push({
            type: 'cascade-response-settled',
            outcome,
            fieldId: held.fieldId,
        });
        held.resolve(outcome);
    };
    const fetch = async (resource, init = {}) => {
        // The accepted fixture owns route, credential, identity, payload and call validation.
        const response = await base.fetch(resource, init);
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const route = url.searchParams.get('route') ?? url.pathname;
        if (
            route === 'fetchExtensionForEndUser' &&
            mode === 'interrupted-prefill'
        ) {
            const page = await response.json();
            for (const schemas of [
                page.payload.fieldIdsToSchemas,
                page.payload.fieldNamesToSchemas,
            ])
                for (const schema of Object.values(schemas))
                    if (schema.airtableField.id === 'fld_projects')
                        schema.miniExtConfig.conditionalLinkedRecordFilteringFieldsType =
                            'hide';
            return new Response(JSON.stringify(page), {
                status: response.status,
                headers: response.headers,
            });
        }
        if (route !== 'fetchPrimaryValuesForConditionalLinkedRecordFilterField')
            return response;
        const input = JSON.parse(String(init.body));
        const fieldId =
            mode === 'search-failure' ? 'fld_country' : 'fld_region';
        if (intercepted || input.linkedRecordsFilterFieldId !== fieldId)
            return response;
        intercepted = true;
        state.pending = { route, fieldId, supplement: mode };
        state.events.push({ type: 'cascade-response-held', fieldId, mode });
        const outcome = await new Promise((resolve) => {
            pending = { resolve, fieldId };
        });
        state.pending = null;
        state.events.push({
            type: 'cascade-response-delivered',
            fieldId,
            outcome,
            aborted: init.signal?.aborted === true,
        });
        // Deliberately settle even after abort, exercising the existing SDK/owner fences.
        if (outcome === 'failure')
            throw new Error('Controlled synthetic cascade read failure.');
        return response;
    };
    return {
        ...base,
        state,
        fetch,
        // Existing fixture inspection renders these as native transport-only buttons.
        addressControls: [
            ['Fail pending cascade read', () => settle('failure')],
            ['Release pending cascade read', () => settle('success')],
        ],
    };
}

export function createCascadeDocument(original, mode) {
    if (!cascadeModes.includes(mode))
        throw new Error('Unknown cascade supplement.');
    const marker = '<script type="module" src="./bootstrap.js"></script>';
    if (original.split(marker).length !== 2)
        throw new Error('Expected one exact archived starter bootstrap.');
    return original.replace(
        marker,
        '<script type="module" src="/cascade-fixture.mjs"></script>'
    );
}

// Only separately scoped supplemental pages load this module as their bootstrap.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const query = new URL(location.href).searchParams;
    if (query.get('scenario') !== 'linked-filters')
        throw new Error('Wrong supplement scenario.');
    const { createPrivacyFixture, installProofInspection } = await import(
        './fixture.js'
    );
    const fixture = createCascadeFixture(
        createPrivacyFixture('linked-filters'),
        query.get('cascadeProof')
    );
    globalThis.fetch = fixture.fetch;
    installProofInspection(fixture, 'starter');
    for (const [id, value] of [
        ['api-origin', 'https://synthetic-sdk.invalid'],
        ['share-id', 'privacy_share_synthetic'],
    ]) {
        const input = document.getElementById(id);
        input.value = value;
        input.readOnly = true;
    }
    await import('./starter/main.js');
}
