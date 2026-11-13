import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    SignatureReceipt,
    type SignatureAppend,
    type SignatureRecovery,
} from '../src/react/signatureReceipt.js';

const authority = {
    ownerIdentity: 'owner',
    fieldId: 'signature',
    method: 'type',
    operationId: 'one',
} as const;
const attachment = { id: null, url: 'https://example.test/signature.png' };

for (const commitBeforeThrow of [false, true]) {
    it(`keeps throwing append uncertain (committed=${commitBeforeThrow}) without deletion or retry`, async () => {
        let releases = 0;
        let calls = 0;
        const value: (typeof attachment)[] = [];
        const error = new Error('host append failed');
        const receipt = new SignatureReceipt(
            {
                attachment,
                release: async () => {
                    releases++;
                    return 'released';
                },
            },
            authority
        );
        const append: SignatureAppend = () => {
            calls++;
            if (commitBeforeThrow) value.push(attachment);
            throw error;
        };
        const recoveries: SignatureRecovery[] = [];
        assert.equal(
            await receipt.settle(
                () => ({ value, append }),
                (r) => recoveries.push(r)
            ),
            'uncertain'
        );
        assert.equal(
            await receipt.settle(
                () => ({ value, append }),
                (r) => recoveries.push(r)
            ),
            'uncertain'
        );
        assert.equal(calls, 1);
        assert.equal(releases, 0);
        assert.equal(value.length, commitBeforeThrow ? 1 : 0);
        assert.equal(recoveries.length, 1);
        assert.equal(recoveries[0]?.error, error);
    });
}

it('releases a positively retired receipt only once', async () => {
    let releases = 0;
    const receipt = new SignatureReceipt(
        {
            attachment,
            release: async () => {
                releases++;
                return 'released';
            },
        },
        authority
    );
    assert.equal(
        await receipt.settle(
            () => null,
            () => assert.fail('unexpected recovery')
        ),
        'released'
    );
    assert.equal(
        await receipt.settle(
            () => null,
            () => assert.fail('unexpected recovery')
        ),
        'released'
    );
    assert.equal(releases, 1);
});

it('transfers once with the latest list and never releases after transfer', async () => {
    const latest = [{ id: 'kept', url: 'https://example.test/kept' }];
    let calls = 0;
    const receipt = new SignatureReceipt(
        {
            attachment,
            release: async () => assert.fail('transferred lease deleted'),
        },
        authority
    );
    const append: SignatureAppend = (request) => {
        calls++;
        assert.equal(request.value, latest);
        return 'appended';
    };
    assert.equal(
        await receipt.settle(
            () => ({ value: latest, append }),
            () => assert.fail('unexpected recovery')
        ),
        'transferred'
    );
    assert.equal(
        await receipt.settle(
            () => null,
            () => assert.fail('unexpected recovery')
        ),
        'transferred'
    );
    assert.equal(calls, 1);
});

for (const result of ['already-released', 'uncertain', 'throw'] as const) {
    it(`records retired release ${result} without retry`, async () => {
        let releases = 0;
        const recoveries: SignatureRecovery[] = [];
        const receipt = new SignatureReceipt(
            {
                attachment,
                release: async () => {
                    releases++;
                    if (result === 'throw') throw new Error('cleanup');
                    return result;
                },
            },
            authority
        );
        assert.equal(
            await receipt.settle(
                () => null,
                (r) => recoveries.push(r)
            ),
            result === 'already-released' ? 'released' : 'uncertain'
        );
        await receipt.settle(
            () => null,
            (r) => recoveries.push(r)
        );
        assert.equal(releases, 1);
        assert.equal(recoveries.length, result === 'already-released' ? 0 : 1);
    });
}
