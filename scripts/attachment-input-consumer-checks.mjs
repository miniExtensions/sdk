import assert from 'node:assert/strict';
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
