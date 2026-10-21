import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const attachmentInputTypedConsumer = `
import {isAttachmentUploadUrlCompatible,getAttachmentFilenameFromUrl,getUploadProgressWeight,getAggregateUploadProgress,type AttachmentUploadProgressInput} from '@miniextensions/sdk/ui';
const attachmentProgress:AttachmentUploadProgressInput={completedUploadWeight:1,currentFileUploadedWeight:1,currentFileTotalWeight:2,totalUploadWeight:4};
const attachmentPercent:number=getAggregateUploadProgress(attachmentProgress);
const attachmentName:string=getAttachmentFilenameFromUrl('https://fixture.invalid/report.pdf');
const attachmentUrlCompatible:boolean=isAttachmentUploadUrlCompatible('https://fixture.invalid/report.pdf');
const emptyFileWeight:number=getUploadProgressWeight(0);
// @ts-expect-error native progress bytes remain numeric
getAggregateUploadProgress({...attachmentProgress,totalUploadWeight:'4'});
// @ts-expect-error native upload URL input is text
getAttachmentFilenameFromUrl(null);

void attachmentPercent;void attachmentName;void attachmentUrlCompatible;void emptyFileWeight;
`;

export const attachmentMetadataTypedConsumer = `
import {checkAttachmentFileMetadata,type AttachmentFileMetadataInput,type AttachmentFileMetadataCheck} from '@miniextensions/sdk/forms';
const metadataInput:AttachmentFileMetadataInput={files:Object.freeze([{type:'image/png',size:4}]),currentCount:1,maxFiles:2,maxFileBytes:4,allowedTypes:['images']};
const metadataResult:AttachmentFileMetadataCheck=checkAttachmentFileMetadata(metadataInput);
const metadataAccepted:readonly number[]=metadataResult.acceptedIndexes;
// @ts-expect-error metadata remains a separate API, not a fabricated loaded Form
checkAttachmentFileMetadata({files:[]});
// @ts-expect-error native size metadata is numeric
checkAttachmentFileMetadata({...metadataInput,files:[{type:'image/png',size:'4'}]});
// @ts-expect-error type groups remain canonical
checkAttachmentFileMetadata({...metadataInput,allowedTypes:['unknown']});
import {getAttachmentRowPolicy,type AttachmentRowPolicy} from '@miniextensions/sdk/forms';
import {captureAttachmentRowActions,type AttachmentRowAuthority,type AttachmentRowActions} from '@miniextensions/sdk/ui';
const nativeRowPolicy:AttachmentRowPolicy=getAttachmentRowPolicy({urls:['native'],persistedUrls:[],readOnly:false,addOnly:true,showExistingValues:false,hidePersistedValues:false});
const rowAuthority:AttachmentRowAuthority={owner:'actual',revision:1,visible:true,editable:true,configs:[{}]};
const rowFacet:AttachmentRowActions=captureAttachmentRowActions({getAuthority:()=>rowAuthority,readRows:()=>[{nativeIndex:0,attachment:{filename:'Current'},visible:true,removeAllowed:true}],isCurrent:()=>true,remove:index=>index===0});
const admittedRow:boolean=rowFacet.remove(0);
// @ts-expect-error native indexes remain numeric
rowFacet.remove('0');
// @ts-expect-error row authority requires a real scoped owner/revision
captureAttachmentRowActions({getAuthority:()=>({visible:true,editable:true,configs:[{}]}),readRows:()=>[],isCurrent:()=>true,remove:()=>true});
void nativeRowPolicy;void admittedRow;
void metadataAccepted;
`;

export async function checkAttachmentInputConsumer({ consumerDirectory }) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        )
    );
    const metadataLoader = join(
        consumerDirectory,
        'attachment-metadata-public.mjs'
    );
    writeFileSync(
        metadataLoader,
        "export {checkAttachmentFileMetadata,getAttachmentRowPolicy} from '@miniextensions/sdk/forms';\n"
    );
    const metadataEsm = await import(pathToFileURL(metadataLoader).href);
    for (const api of [metadataEsm, consumer('@miniextensions/sdk/forms')]) {
        const files = Object.freeze([
            Object.freeze({ type: 'IMAGE/PNG; charset=binary', size: 4 }),
            Object.freeze({ type: 'text/plain', size: 99 }),
            Object.freeze({ type: 'image/png', size: 5 }),
            Object.freeze({ type: 'image/png', size: 4 }),
        ]);
        const input = Object.freeze({
            files,
            currentCount: 1,
            maxFiles: 3,
            maxFileBytes: 4,
            allowedTypes: Object.freeze(['images']),
        });
        assert.deepEqual(api.checkAttachmentFileMetadata(input), {
            acceptedIndexes: [0, 3],
            rejected: [
                { index: 1, reason: 'type' },
                { index: 2, reason: 'size' },
            ],
            batchError: null,
        });
        assert.deepEqual(
            api.checkAttachmentFileMetadata({ ...input, maxFiles: 2 }),
            {
                acceptedIndexes: [],
                rejected: [
                    { index: 1, reason: 'type' },
                    { index: 2, reason: 'size' },
                ],
                batchError: 'count',
            }
        );
        assert.equal(
            api.checkAttachmentFileMetadata({
                ...input,
                files: [],
                currentCount: 4,
            }).batchError,
            'count'
        );
        assert.throws(
            () =>
                api.checkAttachmentFileMetadata({
                    ...input,
                    currentCount: NaN,
                }),
            {
                name: 'TypeError',
                message: 'Expected normalized attachment metadata limits.',
            }
        );
        const sparseTypes = new Array(2);
        sparseTypes[1] = 'images';
        for (const allowedTypes of [new Array(1), sparseTypes])
            assert.throws(
                () =>
                    api.checkAttachmentFileMetadata({ ...input, allowedTypes }),
                {
                    name: 'TypeError',
                    message: 'Expected normalized attachment metadata limits.',
                }
            );
        const single = { ...input, files: [files[0]], currentCount: 0 };
        assert.deepEqual(
            api.checkAttachmentFileMetadata({ ...single, allowedTypes: [] }),
            {
                acceptedIndexes: [],
                rejected: [{ index: 0, reason: 'type' }],
                batchError: null,
            }
        );
        assert.deepEqual(
            api.checkAttachmentFileMetadata({ ...single, allowedTypes: null }),
            {
                acceptedIndexes: [0],
                rejected: [],
                batchError: null,
            }
        );
    }
    console.log(
        'Installed attachment metadata: public ESM/CommonJS runtime and strict NodeNext/Bundler declarations passed.'
    );
    const rowLoader = join(consumerDirectory, 'attachment-row-public.mjs');
    writeFileSync(
        rowLoader,
        "export {captureAttachmentRowActions} from '@miniextensions/sdk/ui';\n"
    );
    const rowEsm = await import(pathToFileURL(rowLoader).href);
    for (const api of [rowEsm, consumer('@miniextensions/sdk/ui')]) {
        const authority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [{}],
        };
        let writes = 0,
            reads = 0;
        const make = () =>
            api.captureAttachmentRowActions({
                getAuthority: () => authority,
                readRows: () => {
                    reads++;
                    return [
                        {
                            nativeIndex: 0,
                            attachment: { filename: 'Current', url: 'PRIVATE' },
                            visible: true,
                            removeAllowed: true,
                        },
                    ];
                },
                isCurrent: () => true,
                remove: () => {
                    writes++;
                    return true;
                },
            });
        const facet = make();
        assert.deepEqual(facet.presentation, {
            status: 'ready',
            rows: [{ label: 'Attachment' }],
        });
        assert.equal(JSON.stringify(facet).includes('PRIVATE'), false);
        authority.revision = 2;
        assert.equal(facet.remove(0), false);
        assert.equal(writes, 0);
        assert.equal(make().remove(0), true);
        assert.equal(writes, 1);
        const cloneDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'structuredClone'
        );
        try {
            Reflect.defineProperty(globalThis, 'structuredClone', {
                configurable: true,
                writable: true,
                value: undefined,
            });
            assert.deepEqual(make().presentation, {
                status: 'ready',
                rows: [{ label: 'Attachment' }],
            });
        } finally {
            if (cloneDescriptor)
                Reflect.defineProperty(
                    globalThis,
                    'structuredClone',
                    cloneDescriptor
                );
            else Reflect.deleteProperty(globalThis, 'structuredClone');
        }
        authority.configs = [{ obscurePassword: true }];
        const before = reads;
        assert.equal(make().presentation.status, 'masked');
        assert.equal(reads, before);
    }
    for (const api of [metadataEsm, consumer('@miniextensions/sdk/forms')]) {
        const policy = api.getAttachmentRowPolicy({
            urls: ['native', 'pending', 'native'],
            persistedUrls: ['native'],
            readOnly: false,
            addOnly: true,
            showExistingValues: false,
            hidePersistedValues: false,
        });
        assert.equal(policy.status, 'ready');
        assert.deepEqual(
            policy.rows.map((row) => [
                row.nativeIndex,
                row.visible,
                row.removeAllowed,
            ]),
            [
                [0, false, false],
                [1, true, true],
                [2, false, false],
            ]
        );
    }
    console.log(
        'Installed attachment row bridge: public ESM/CommonJS privacy, native admission and revision actions plus strict NodeNext/Bundler declarations passed.'
    );
    let groups = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/ui')]) {
        assert.equal(
            api.isAttachmentUploadUrlCompatible(
                'http://fixture.invalid/report'
            ),
            true
        );
        assert.equal(api.isAttachmentUploadUrlCompatible('/relative'), false);
        assert.equal(
            api.isAttachmentUploadUrlCompatible('data:text/plain,test'),
            false
        );
        assert.equal(
            api.getAttachmentFilenameFromUrl(
                'https://fixture.invalid/report%20one.pdf?download=1#part'
            ),
            'report one.pdf'
        );
        assert.equal(
            api.getAttachmentFilenameFromUrl('https://fixture.invalid/folder/'),
            'fixture.invalid'
        );
        assert.equal(
            api.getAttachmentFilenameFromUrl(
                'https://fixture.invalid/%E0%A4%A'
            ),
            '%E0%A4%A'
        );
        assert.throws(
            () => api.getAttachmentFilenameFromUrl('relative'),
            TypeError
        );
        assert.equal(api.getUploadProgressWeight(0), 1);
        assert.equal(
            api.getAggregateUploadProgress({
                completedUploadWeight: 25,
                currentFileUploadedWeight: 50,
                currentFileTotalWeight: 50,
                totalUploadWeight: 100,
            }),
            75
        );
        assert.equal(
            api.getAggregateUploadProgress({
                completedUploadWeight: 0,
                currentFileUploadedWeight: 0,
                currentFileTotalWeight: 0,
                totalUploadWeight: 0,
            }),
            100
        );
        groups++;
    }
    return groups;
}
