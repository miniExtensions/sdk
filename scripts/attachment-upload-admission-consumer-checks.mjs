import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const attachmentUploadAdmissionTypedConsumer = `
import {captureAttachmentUploadAdmission,type AttachmentUploadAdmission,type AttachmentUploadAuthority} from '@miniextensions/sdk/ui';
const uploadAuthority:AttachmentUploadAuthority={owner:'real-host',revision:1,visible:true,editable:true};
const uploadAdmission:AttachmentUploadAdmission=captureAttachmentUploadAdmission({getAuthority:()=>uploadAuthority,isCurrent:()=>true});
const allocation=uploadAdmission.admit(()=>Promise.resolve(new File(['native'],'native.txt')));
if(allocation.accepted){const samePromise:Promise<File>=allocation.value;void samePromise;}
// @ts-expect-error actual provenance and mounted lease are required
captureAttachmentUploadAdmission({isCurrent:()=>true});
// @ts-expect-error the admission facet never owns transport cancellation
uploadAdmission.cancel();
// @ts-expect-error policy is an actual boolean, not a truthy marker
const invalidUploadAuthority:AttachmentUploadAuthority={owner:'host',revision:1,visible:'yes',editable:true};
void invalidUploadAuthority;
`;
export async function checkAttachmentUploadAdmissionConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'attachment-upload-admission-public.mjs'
    );
    writeFileSync(
        loader,
        "export {captureAttachmentUploadAdmission} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        let now = { owner: 'host', revision: 1, visible: true, editable: true },
            calls = 0;
        const old = api.captureAttachmentUploadAdmission({
            getAuthority: () => now,
            isCurrent: () => true,
        });
        now = { ...now, revision: 3 };
        assert.deepEqual(
            old.admit(() => ++calls),
            { accepted: false }
        );
        assert.equal(calls, 0);
        const next = api.captureAttachmentUploadAdmission({
            getAuthority: () => now,
            isCurrent: () => true,
        });
        let finish;
        const held = new Promise((resolve) => {
            finish = resolve;
        });
        const allocated = next.admit(() => {
            calls++;
            return held;
        });
        assert.equal(allocated.accepted, true);
        assert.equal(allocated.value, held);
        now = { ...now, editable: false };
        next.retire();
        assert.deepEqual(
            next.admit(() => ++calls),
            { accepted: false }
        );
        const native = { url: 'host-native' };
        finish(native);
        assert.equal(await allocated.value, native);
        assert.equal(calls, 1);
        const failure = new Error('original-host-recovery');
        const retry = api.captureAttachmentUploadAdmission({
            getAuthority: () => ({ ...now, editable: true }),
            isCurrent: () => true,
        });
        assert.throws(
            () =>
                retry.admit(() => {
                    throw failure;
                }),
            (error) => error === failure
        );
        assert.equal(retry.isCurrent(), false);
    }
    return 2;
}
