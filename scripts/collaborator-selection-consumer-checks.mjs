import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const collaboratorSelectionTypedConsumer = `
import {getCollaboratorSelectionPresentation,removeCollaboratorSelection,type CollaboratorSelectionPresentation} from '@miniextensions/sdk/ui';
const hostedCollaboratorNative = Object.freeze([Object.freeze({id:'usrSynthetic',name:'Synthetic',email:'synthetic@example.invalid',extraNativeValue:17})]);
const hostedCollaboratorRemaining = removeCollaboratorSelection(hostedCollaboratorNative,'other');
const hostedCollaboratorExtra:number = hostedCollaboratorRemaining[0]!.extraNativeValue;
const hostedCollaboratorPresentation:CollaboratorSelectionPresentation = getCollaboratorSelectionPresentation({selectedCount:hostedCollaboratorRemaining.length,readOnly:false,limitToOneSelection:true});
const hostedCollaboratorEditable:boolean = hostedCollaboratorPresentation.canRemove;
// @ts-expect-error counts retain their numeric contract
getCollaboratorSelectionPresentation({selectedCount:'1',readOnly:false});
// @ts-expect-error read-only presentation is a boolean, not text
getCollaboratorSelectionPresentation({selectedCount:1,readOnly:'false'});
// @ts-expect-error native removal IDs remain strings
removeCollaboratorSelection(hostedCollaboratorNative,17);
// @ts-expect-error native objects must carry a string ID
removeCollaboratorSelection([{id:17}],'17');
// @ts-expect-error native metadata keeps its inferred type
const hostedCollaboratorWrongExtra:string = hostedCollaboratorRemaining[0]!.extraNativeValue;
void hostedCollaboratorExtra;void hostedCollaboratorEditable;void hostedCollaboratorWrongExtra;
`;

/** The actual installed public export map, never checkout or built-file aliases. */
export async function checkCollaboratorSelectionConsumer({
    consumerDirectory,
}) {
    const loader = join(consumerDirectory, 'collaborator-selection-public.mjs');
    writeFileSync(
        loader,
        "export {getCollaboratorSelectionPresentation,removeCollaboratorSelection} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    let groups = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/ui')]) {
        assert.deepEqual(
            api.getCollaboratorSelectionPresentation({
                selectedCount: 1,
                readOnly: false,
                limitToOneSelection: true,
            }),
            { showSelector: false, showEmpty: false, canRemove: true }
        );
        assert.deepEqual(
            api.getCollaboratorSelectionPresentation({
                selectedCount: 0,
                readOnly: true,
            }),
            { showSelector: false, showEmpty: true, canRemove: false }
        );
        for (const selectedCount of [1, 2]) {
            assert.equal(
                api.getCollaboratorSelectionPresentation({
                    selectedCount,
                    readOnly: false,
                }).showSelector,
                true
            );
        }
        assert.equal(
            api.getCollaboratorSelectionPresentation({
                selectedCount: 2,
                readOnly: false,
                limitToOneSelection: true,
            }).showSelector,
            true
        );
        const first = Object.freeze({ id: 'usrFirst', name: 'Same label' });
        const duplicate = Object.freeze({ ...first, name: 'Lookup duplicate' });
        const neighbor = Object.freeze({
            id: 'usrNeighbor',
            name: 'Same label',
            email: 'neighbor@example.invalid',
            extraNativeValue: 17,
        });
        const native = Object.freeze([first, neighbor, duplicate, neighbor]);
        const remaining = api.removeCollaboratorSelection(native, first.id);
        assert.deepEqual(remaining, [neighbor, neighbor]);
        assert.equal(remaining[0], neighbor);
        assert.equal(remaining[1], neighbor);
        assert.deepEqual(native, [first, neighbor, duplicate, neighbor]);
        assert.deepEqual(api.removeCollaboratorSelection([], 'missing'), []);
        assert.deepEqual(
            api.removeCollaboratorSelection(native, 'missing'),
            native
        );
        groups++;
    }
    return groups;
}
