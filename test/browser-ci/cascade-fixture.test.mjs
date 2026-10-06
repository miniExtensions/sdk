import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createCascadeDocument,
    createCascadeFixture,
} from './cascade-fixture.mjs';

const input = process.env.SDK_FIXTURE_ZIP_DIR;
assert(
    input && input === resolve(input),
    'Explicit original fixture ZIP directory required.'
);
const names = readdirSync(input);
assert.equal(names.length, 1);
const work = mkdtempSync(join(tmpdir(), 'sdk-cascade-fixture-test-'));
after(() => rmSync(work, { recursive: true, force: true }));
const source = execFileSync('python3', [
    '-c',
    `
import hashlib,sys,zipfile
p=sys.argv[1]; b=open(p,'rb').read()
assert hashlib.sha256(b).hexdigest()=='858df529c288fa5e37a0b7bef7f7a08e327d7b3d0f63f56afebf6457fa2d4e11'
with zipfile.ZipFile(p) as z:
 assert z.testzip() is None
 sys.stdout.buffer.write(z.read('fixture.js'))
`,
    join(input, names[0]),
]);
writeFileSync(join(work, 'package.json'), '{"type":"module"}');
writeFileSync(join(work, 'fixture.js'), source);
const { createPrivacyFixture } = await import(
    pathToFileURL(join(work, 'fixture.js')).href
);
const fixture = (mode) =>
    createCascadeFixture(createPrivacyFixture('linked-filters'), mode);
const call = (f, route, data, signal) =>
    f.fetch(`https://synthetic-sdk.invalid/api?route=${route}`, {
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(data),
        signal,
    });
const filter = (f, id, signal) =>
    call(
        f,
        'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
        {
            extensionAccessToken: 'FAKE_SYNTHETIC_INTERACTION_TOKEN',
            mainTableLinkedRecordsFieldId: 'fld_projects',
            linkedRecordsFilterFieldId: id,
            searchTerm: '',
            urlSearchValue: null,
            filterData: null,
        },
        signal
    );
const control = (f, label) => {
    const found = f.addressControls.filter(([text]) => text === label);
    assert.equal(found.length, 1);
    found[0][1]();
};
const held = async (f) => {
    for (let i = 0; i < 20 && f.state.pending == null; i++)
        await Promise.resolve();
    assert(
        f.state.pending,
        'Read must be held until an explicit native-control action.'
    );
};

test('supplement changes only hidden presentation on root responses, retaining exact native/config authority', async () => {
    const base = createPrivacyFixture('linked-filters');
    const plain = await (
        await call(base, 'fetchExtensionForEndUser', {
            shareId: 'privacy_share_synthetic',
        })
    ).json();
    const f = fixture('interrupted-prefill');
    const hidden = await (
        await call(f, 'fetchExtensionForEndUser', {
            shareId: 'privacy_share_synthetic',
        })
    ).json();
    for (const map of ['fieldIdsToSchemas', 'fieldNamesToSchemas'])
        for (const value of Object.values(plain.payload[map]))
            if (value.airtableField.id === 'fld_projects')
                value.miniExtConfig.conditionalLinkedRecordFilteringFieldsType =
                    'hide';
    assert.deepEqual(hidden, plain);
    assert.deepEqual(hidden.payload.formRecord.data, {
        fld_driver: 'denied',
        fld_projects: ['rec_retained'],
    });
});

test('one controlled Region failure retains Country response, retires on settlement and cannot retry automatically', async () => {
    const f = fixture('interrupted-prefill');
    const country = await filter(f, 'fld_country');
    assert.equal(
        (await country.json()).primaryValues[0].recordId,
        'rec_country_north'
    );
    const pending = filter(f, 'fld_region');
    await held(f);
    assert.equal(f.state.calls.length, 2);
    control(f, 'Fail pending cascade read');
    await assert.rejects(pending, /Controlled synthetic cascade read failure/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.state.calls.length, 2);
    assert.equal(f.state.pending, null);
    const retry = await filter(f, 'fld_region');
    assert.equal(
        (await retry.json()).primaryValues[0].recordId,
        'rec_region_one'
    );
    assert.equal(
        f.state.events.filter((event) => event.type === 'cascade-response-held')
            .length,
        1
    );
    assert.equal(
        f.state.events.filter(
            (event) =>
                event.outcome === 'failure' &&
                event.type === 'cascade-response-delivered'
        ).length,
        1
    );
});

test('ordinary-search injection targets Country once and retains explicit retry semantics', async () => {
    const f = fixture('search-failure');
    const pending = filter(f, 'fld_country');
    await held(f);
    control(f, 'Fail pending cascade read');
    await assert.rejects(pending);
    assert.equal(f.state.calls.length, 1);
    assert((await filter(f, 'fld_country')).ok);
    assert.equal(f.state.calls.length, 2);
});

test('owner replacement release deliberately delivers the old response after abort; it dispatches no write', async () => {
    const f = fixture('owner-replacement');
    const controller = new AbortController();
    const pending = filter(f, 'fld_region', controller.signal);
    await held(f);
    controller.abort();
    control(f, 'Release pending cascade read');
    assert.equal(
        (await (await pending).json()).primaryValues[0].recordId,
        'rec_region_one'
    );
    assert.equal(
        f.state.events.find(
            (event) => event.type === 'cascade-response-delivered'
        ).aborted,
        true
    );
    assert.equal(f.state.calls.length, 1);
    assert.equal(
        f.state.calls.filter((value) => value.route === 'saveForm').length,
        0
    );
    control(f, 'Fail pending cascade read');
    assert.equal(
        f.state.events.filter(
            (event) => event.type === 'cascade-response-settled'
        ).length,
        1
    );
});

test('closed fixture validation remains authoritative, and malformed supplement documents fail closed', async () => {
    const f = fixture('search-failure');
    await assert.rejects(
        f.fetch('https://example.invalid/api', { credentials: 'omit' }),
        /Non-synthetic/
    );
    assert.throws(() =>
        createCascadeFixture(createPrivacyFixture('pin'), 'search-failure')
    );
    assert.throws(() => fixture('invented'));
    const marker = '<script type="module" src="./bootstrap.js"></script>';
    assert.equal(
        createCascadeDocument(marker, 'search-failure'),
        '<script type="module" src="/cascade-fixture.mjs"></script>'
    );
    assert.throws(() =>
        createCascadeDocument(marker + marker, 'search-failure')
    );
    assert.throws(() => createCascadeDocument('', 'search-failure'));
    assert.throws(() => createCascadeDocument(marker, 'invented'));
});
