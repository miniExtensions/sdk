import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const childNavigationTypedConsumer = `
import {findAdjacentChildSession,type AdjacentChildNavigationContext,type AdjacentChildNavigationInput} from '@miniextensions/sdk/ui';
const navigationOrigin:AdjacentChildNavigationContext={type:'modal',recordId:'current',parentFormExtensionSessionId:'parent',fieldIdOfLinkedRecordField:'links',linkedTableIdOfLinkedRecordField:'table',parentExtensionAccessToken:'token',childExtensionAccessInfo:{childExtensionId:'child'},nextRecordId:'next'};
const navigationInput:AdjacentChildNavigationInput={sourceExtensionSessionId:'origin',type:'next',recordId:'next'};
const navigationResult:string|null=findAdjacentChildSession(Object.freeze({origin:navigationOrigin,target:{...navigationOrigin,recordId:'next'}}),navigationInput);
// @ts-expect-error only actual adjacent directions are accepted
findAdjacentChildSession({origin:navigationOrigin},{...navigationInput,type:'later'});
// @ts-expect-error source session identity is required
findAdjacentChildSession({origin:navigationOrigin},{type:'next',recordId:'next'});
// @ts-expect-error context record identity remains text or null
findAdjacentChildSession({origin:{...navigationOrigin,recordId:17}},navigationInput);
import { createElement as createPortalNavigationElement } from 'react';
import {
    PortalSidePanelNavigation,
    type PortalSidePanelNavigationProps,
    type PortalSidePanelNavigationRequest,
} from '@miniextensions/sdk/react';
const portalNavigationProps: PortalSidePanelNavigationProps = {
    frame: {
        ownerToken: {},
        sourceExtensionSessionId: 'origin',
        sourceRecordId: 'current',
        previousRecordId: null,
        nextRecordId: 'next',
    },
    labels: { previous: 'Précédent', next: 'Suivant' },
    isCurrent: request => !request.signal.aborted && request.sourceRecordId === 'current',
    confirmDismissal: async () => true,
    openAdjacent: (request: PortalSidePanelNavigationRequest) => { void findAdjacentChildSession({origin:navigationOrigin}, request); },
};
createPortalNavigationElement(PortalSidePanelNavigation, portalNavigationProps);
// @ts-expect-error native ownership supplies the current-frame admission
const missingPortalNavigationAdmission: PortalSidePanelNavigationProps = { frame: null, labels: portalNavigationProps.labels, confirmDismissal: () => true, openAdjacent() {} };
void navigationResult;
void missingPortalNavigationAdmission;
`;
export async function checkChildNavigationConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'child-navigation-public.mjs');
    writeFileSync(
        loader,
        [
            "export {findAdjacentChildSession} from '@miniextensions/sdk/ui';",
            "export {PortalSidePanelNavigation} from '@miniextensions/sdk/react';",
        ].join('\n')
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const child = (recordId, type = 'modal') => ({
        type,
        recordId,
        parentFormExtensionSessionId: 'parent',
        fieldIdOfLinkedRecordField: 'links',
        linkedTableIdOfLinkedRecordField: 'table',
        parentExtensionAccessToken: 'token',
        childExtensionAccessInfo: { childExtensionId: 'child' },
        nextRecordId: 'next',
        previousRecordId: 'previous',
    });
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        for (const type of ['modal', 'side-panel', 'form-layout'])
            for (const direction of ['next', 'previous']) {
                const origin = Object.freeze(child('current', type));
                const target = Object.freeze({
                    ...child(direction, type),
                    get privateNativePayload() {
                        throw new Error('PRIVATE_NATIVE');
                    },
                });
                const input = {
                    sourceExtensionSessionId: 'origin',
                    type: direction,
                    recordId: direction,
                };
                const contexts = Object.freeze({
                    origin,
                    target,
                    direct: Object.freeze({ type: 'direct-url' }),
                });
                assert.equal(
                    api.findAdjacentChildSession(contexts, input),
                    'target'
                );
                assert.equal(
                    api.findAdjacentChildSession(
                        { origin, target, duplicate: target },
                        input
                    ),
                    null
                );
                assert.equal(
                    api.findAdjacentChildSession({ target }, input),
                    null
                );
                assert.equal(
                    api.findAdjacentChildSession(contexts, {
                        ...input,
                        recordId: 'wrong',
                    }),
                    null
                );
                for (const patch of [
                    { parentFormExtensionSessionId: 'other' },
                    { fieldIdOfLinkedRecordField: 'other' },
                    { linkedTableIdOfLinkedRecordField: 'other' },
                    { parentExtensionAccessToken: 'other' },
                    { childExtensionAccessInfo: { childExtensionId: 'other' } },
                    {
                        prefillDataForLinkedRecordsForm: {
                            toLinkToParent: {
                                parentFormRecordId: 'other',
                                reversedFieldIdToPrefill: 'reverse',
                            },
                        },
                    },
                ]) {
                    // Build owner metadata directly; spreading target would itself
                    // invoke the intentionally throwing private-payload getter.
                    const foreign = { ...child(direction, type), ...patch };
                    assert.equal(
                        api.findAdjacentChildSession(
                            { origin, target, foreign },
                            input
                        ),
                        'target'
                    );
                    assert.equal(
                        api.findAdjacentChildSession(
                            { origin, foreign },
                            input
                        ),
                        null
                    );
                }
                assert.equal(
                    api.findAdjacentChildSession(
                        { origin: { type: 'direct-url' }, target },
                        input
                    ),
                    null
                );
                assert.equal(target.recordId, direction);
            }
    }
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    for (const Navigation of [
        esm.PortalSidePanelNavigation,
        require('@miniextensions/sdk/react').PortalSidePanelNavigation,
    ]) {
        const props = {
            labels: { previous: 'Précédent', next: 'Suivant' },
            isCurrent: () => true,
            confirmDismissal: () => false,
            openAdjacent: () => assert.fail('Unexpected SSR open'),
        };
        const html = renderToStaticMarkup(
            createElement(Navigation, {
                ...props,
                frame: {
                    ownerToken: {},
                    sourceExtensionSessionId: 'origin',
                    sourceRecordId: 'current',
                    previousRecordId: null,
                    nextRecordId: 'next',
                },
            })
        );
        assert.match(html, /type="button" disabled="".*Précédent/);
        assert.match(html, /type="button" class="[^"]+">Suivant/);
        assert.equal(
            renderToStaticMarkup(
                createElement(Navigation, { ...props, frame: null })
            ),
            ''
        );
    }
    console.log(
        'Installed adjacent-child compatibility: public ESM/CommonJS owner collisions, declared order, ambiguity, immutable native contexts localized React controls, and strict NodeNext/Bundler declarations passed; no client, request or writer.'
    );
    return 2;
}
