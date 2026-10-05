import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import {
    dirname,
    extname,
    isAbsolute,
    join,
    relative,
    resolve,
} from 'node:path';
import { By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

// This bounded job reuses these immutable push artifacts; it never rebuilds SDK.
// Native controls: shipped examples/browser/src/{main,portal}.ts and the entire
// docs/auth.md AuthPanel fence. API: selenium.dev/selenium/docs/api/javascript/
// module-selenium-webdriver_chrome-Driver.html (explicit DriverService session).
const expected = {
    source: {
        commit: '2fda7938b347cc1cb0f82302c424de96862f69f3',
        tree: '9cfd23097b178804dddbec4a3ed4e904b8b36106',
    },
    runId: '37341389181',
    packageArtifactId: '11357789263',
    fixtureArtifactId: '11357639404',
    packageZipSha256:
        '66b077f17684ce22b17dee28c776ffdf9b9f7ef7acf6bb66e5a45935f0c471c4',
    fixtureZipSha256:
        '79b0b63f43d1c665d0158bbadbebf4a7358f75d366e966115f40e117e37046ae',
    packageSha256:
        'dbadca9bfed9efcd1f45b1ca8059e6ebdf02ac6ebad8d037928d4bd6cf8a5b50',
    packageBytes: 210721,
    packageFiles: 165,
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => {
    const part = relative(root, path);
    return (
        part === '' ||
        (!part.startsWith('../') && part !== '..' && !isAbsolute(part))
    );
};
const requiredPath = (name) => {
    const path = process.env[name];
    assert(
        path && isAbsolute(path),
        `${name} must be an explicit absolute path.`
    );
    return resolve(path);
};
const run = (command, args) =>
    execFileSync(command, args, {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
    });
const regular = (path) => {
    assert(lstatSync(path).isFile(), `Not a regular file: ${path}`);
    assert.equal(realpathSync(path), resolve(path), `Symlink refused: ${path}`);
    return readFileSync(path);
};
const onlyZip = (directory) => {
    assert.equal(realpathSync(directory), directory);
    const files = readdirSync(directory);
    assert.equal(
        files.length,
        1,
        'Each download must contain exactly one immutable ZIP.'
    );
    const path = join(directory, files[0]);
    regular(path);
    return path;
};

// Python's standard library verifies ZIP CRC/types/paths before writing any
// member, then checks TGZ provenance, native source hashes and all static outputs.
const verifyArtifacts = String.raw`
import hashlib,io,json,pathlib,re,stat,sys,tarfile,zipfile
package_zip,fixture_zip,work,expected = sys.argv[1:]
expected=json.loads(expected); work=pathlib.Path(work)
def sha(b): return hashlib.sha256(b).hexdigest()
def safe(name):
    p=pathlib.PurePosixPath(name)
    assert name and '\\' not in name and not p.is_absolute() and '..' not in p.parts
    assert str(p)==name and name not in ('.','..')
    return name
def unpack(path,directory,digest,count):
    data=pathlib.Path(path).read_bytes(); assert sha(data)==digest
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        members=z.infolist(); assert len(members)==count
        assert len({i.filename for i in members})==len(members)
        assert z.testzip() is None
        for i in members:
            safe(i.filename); assert not i.is_dir()
            mode=i.external_attr>>16
            assert stat.S_IFMT(mode) in (0,stat.S_IFREG)
        directory.mkdir()
        for i in members:
            target=directory/i.filename; target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as f: f.write(z.read(i))
    return [i.filename for i in members]
package=work/'package'; fixture=work/'fixture'
package_names=unpack(package_zip,package,expected['packageZipSha256'],4)
fixture_names=unpack(fixture_zip,fixture,expected['fixtureZipSha256'],18)
def sums(directory,names,count):
    lines=(directory/'SHA256SUMS').read_text().splitlines(); assert len(lines)==count
    paths=[]
    for line in lines:
        match=re.fullmatch(r'([a-f0-9]{64})  (.+)',line); assert match
        digest,name=match.groups(); safe(name); assert sha((directory/name).read_bytes())==digest
        paths.append(name)
    assert len(set(paths))==len(paths)
    return paths
assert set(sums(fixture,fixture_names,17))==set(fixture_names)-{'SHA256SUMS'}
sums(package,package_names,2)
receipt=json.loads((package/'artifact-receipt.json').read_text())
manifest=json.loads((fixture/'manifest.json').read_text())
for value in [receipt,manifest]:
    assert value['source']==expected['source']
    ci=value['ci']; assert ci['repository']=='miniExtensions/sdk' and ci['event']=='push'
    assert ci['runId']==expected['runId'] and ci['runAttempt']=='1'
    assert ci['workflowSha']==expected['source']['commit']
    assert value['package']['sha256']==expected['packageSha256']
    assert value['package']['bytes']==expected['packageBytes']
assert receipt['verification']['outcome']=='passed'
assert receipt['package']['files']==expected['packageFiles']
tgz=(package/receipt['package']['filename']).read_bytes()
assert len(tgz)==expected['packageBytes'] and sha(tgz)==expected['packageSha256']
with tarfile.open(fileobj=io.BytesIO(tgz),mode='r:gz') as t:
    files={}
    for member in t.getmembers():
        safe(member.name); assert member.isfile()
        assert member.name not in files
        files[member.name]=t.extractfile(member).read()
assert len(files)==expected['packageFiles']
def check(entry,data):
    assert len(data)==entry['bytes'] and sha(data)==entry['sha256']
assert len(manifest['outputs'])==16
assert len({e['path'] for e in manifest['outputs']})==16
for entry in manifest['outputs']:
    safe(entry['path']); check(entry,(fixture/entry['path']).read_bytes())
assert {e['path'] for e in manifest['outputs']}==set(fixture_names)-{'SHA256SUMS','manifest.json'}
assert len(manifest['sources'])==11
for entry in manifest['sources']:
    origin=entry['origin']
    if origin=='packed-browser-starter': data=files['package/examples/browser/'+safe(entry['path'])]
    elif origin=='installed-archive-doc': data=files['package/'+safe(entry['path'])]
    else:
        assert origin=='complete-unchanged-tsx-fence' and entry['path']=='docs/auth.md#AuthPanel'
        fence=chr(96)*3
        recipe=[s for s in re.findall(fence+r'tsx\n([\s\S]*?)\n'+fence,files['package/docs/auth.md'].decode()) if 'export function AuthPanel(' in s]
        assert len(recipe)==1; data=recipe[0].encode()
    check(entry,data)
sdk_counts={}
for kind,count in [('starter',18),('auth',7)]:
    entries=[e for e in manifest['bundleInputs'][kind] if e['origin']=='installed-sdk-archive']
    assert len(entries)==count
    for entry in entries:
        prefix='node_modules/@miniextensions/sdk/'
        assert entry['path'].startswith(prefix)
        member=safe(entry['path'][len(prefix):]); assert member.startswith('dist/')
        check(entry,files['package/'+member])
    sdk_counts[kind]=len(entries)
assert manifest['provenance']['actualPackedStarterBuildReused'] is True
assert manifest['provenance']['completeAuthPanelFence'] is True
assert manifest['provenance']['sdkSourceAliases'] is False
assert manifest['provenance']['packageRepacked'] is False
print(json.dumps({'source':manifest['source'],'ci':manifest['ci'],'package':manifest['package'],
 'manifestSha256':sha((fixture/'manifest.json').read_bytes()),'fixtureFiles':len(fixture_names),
 'checksums':17,'outputs':16,'sources':11,'sdkBundleInputs':sdk_counts}))
`;

const output = requiredPath('SDK_BROWSER_RESULTS_DIR');
assert(!existsSync(output), 'Refuse an existing result directory.');
assert.equal(realpathSync(dirname(output)), dirname(output));
mkdirSync(output);
const work = mkdtempSync(join(tmpdir(), 'sdk-synthetic-chromium-'));
const receipt = {
    schemaVersion: 1,
    status: 'running',
    scope: 'Automated W3C WebDriver synthetic UI proof; no independent manual or live backend credit.',
    expected,
    startedAt: new Date().toISOString(),
    cases: [],
    cleanup: {},
    limits: [
        'Immutable synthetic transport only; no service writes or public demo access.',
        'No backend permission, OTP delivery, Airtable persistence or hosted UI parity proof.',
        'No independent exploratory/manual Chrome credit.',
        'Hidden/blank title and fallback verification variants are not in this fixture.',
    ],
};
const writeJson = (path, data) =>
    writeFileSync(join(output, path), JSON.stringify(data, null, 2) + '\n');
let driver;
let service;
let server;
let origin;
let stage = 'provenance';
let priorBrowserPids = new Set();
let browserBinary;
let chromedriverBinary;
const browserProcesses = () =>
    run('ps', ['-eo', 'pid=,args='])
        .split('\n')
        .flatMap((line) => {
            const match = line.trim().match(/^(\d+) (.*)$/);
            return match &&
                (match[2].includes(browserBinary) ||
                    match[2].includes(chromedriverBinary))
                ? [{ pid: Number(match[1]), command: match[2] }]
                : [];
        });

const snapshot = () =>
    driver.executeScript('return window.__privacyBrowserProof.snapshot();');
const waitSnapshot = (predicate, description) =>
    driver.wait(
        async () => {
            const value = await snapshot();
            assert.deepEqual(
                value.unexpected,
                [],
                'Unexpected request or browser error.'
            );
            return predicate(value) ? value : false;
        },
        10000,
        description
    );
const find = (selector) => driver.findElement(By.css(selector));
const clickText = async (text, root = driver) => {
    const buttons = await root.findElements(By.css('button'));
    const matches = [];
    for (const button of buttons)
        if ((await button.getText()).trim() === text) matches.push(button);
    assert.equal(matches.length, 1, `Expected one native ${text} button.`);
    assert((await matches[0].isDisplayed()) && (await matches[0].isEnabled()));
    await matches[0].click();
};
const replaceInput = async (input, value, type) => {
    assert.equal(await input.getAttribute('type'), type);
    await input.clear();
    await input.sendKeys(value);
    assert.equal(
        await input.getAttribute('value'),
        value,
        'Native credential/edit bytes changed.'
    );
};
const applicationText = (surface) =>
    find(surface === 'starter' ? '#screen' : '#auth-root');
const noVisibleSecret = async (surface, secret) => {
    assert(
        !(await (await applicationText(surface)).getText()).includes(secret)
    );
    if (surface === 'starter')
        assert(!(await (await find('#status')).getText()).includes(secret));
};
const assertCalls = (state, routes) => {
    assert.deepEqual(state.unexpected, []);
    assert.deepEqual(
        state.calls.map((v) => v.route),
        routes
    );
    assert(state.calls.every((v) => v.credentialsMode === 'omit'));
};
const capture = async (caseResult, name) => {
    let state;
    try {
        state = await snapshot();
        caseResult.observations.push({ stage: name, snapshot: state });
    } catch (error) {
        caseResult.observations.push({
            stage: name,
            diagnosticError: String(error),
        });
    }
    const filename = `${caseResult.id}-${name}.png`;
    writeFileSync(
        join(output, filename),
        Buffer.from(await driver.takeScreenshot(), 'base64')
    );
    caseResult.screenshots.push(filename);
    return state;
};
const exercise = async (id, body) => {
    const result = { id, status: 'running', observations: [], screenshots: [] };
    receipt.cases.push(result);
    try {
        await body(result);
        assert.deepEqual((await snapshot()).unexpected, []);
        result.status = 'passed';
    } catch (error) {
        result.status = 'failed';
        result.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
        try {
            await capture(result, 'failure');
        } catch (e) {
            result.evidenceError = String(e);
        }
    } finally {
        writeJson(`${id}.json`, result);
    }
};

const authCases = [
    {
        id: 'pin',
        name: 'Identifier',
        value: 'Exact-Case PIN 07',
        type: 'password',
    },
    {
        id: 'password',
        name: 'Identifier',
        value: 'Exact-Case Password 09',
        type: 'password',
    },
    {
        id: 'word',
        name: 'Identifier',
        value: 'Exact ordinary identifier',
        type: 'text',
    },
    {
        id: 'email',
        name: 'Email',
        value: 'Privacy.Exact+Email@example.test',
        type: 'password',
        otp: true,
    },
    {
        id: 'phone',
        name: 'Phone',
        value: '+15550102030',
        type: 'password',
        otp: true,
    },
];

try {
    assert.equal(
        process.env.GITHUB_ACTIONS,
        'true',
        'Only the authorized hosted CI route may launch this harness.'
    );
    assert.equal(process.version, 'v22.23.3');
    assert.match(
        readFileSync('/etc/os-release', 'utf8'),
        /^VERSION_ID="24\.04"$/m
    );
    const harnessCommit = run('git', ['rev-parse', 'HEAD']).trim();
    assert.equal(harnessCommit, process.env.GITHUB_SHA);
    receipt.harness = {
        commit: harnessCommit,
        tree: run('git', ['rev-parse', 'HEAD^{tree}']).trim(),
        sourceSha256: sha256(readFileSync(new URL(import.meta.url))),
        lockSha256: sha256(
            readFileSync(new URL('package-lock.json', import.meta.url))
        ),
    };
    const seleniumVersion = JSON.parse(
        readFileSync(
            new URL(
                'node_modules/selenium-webdriver/package.json',
                import.meta.url
            ),
            'utf8'
        )
    ).version;
    assert.equal(seleniumVersion, '4.50.0');
    receipt.harness.seleniumVersion = seleniumVersion;
    receipt.ci = {
        repository: process.env.GITHUB_REPOSITORY,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        imageOS: process.env.ImageOS,
        imageVersion: process.env.ImageVersion,
        node: process.version,
    };
    receipt.artifactVerification = JSON.parse(
        run('python3', [
            '-c',
            verifyArtifacts,
            onlyZip(requiredPath('SDK_PACKAGE_ZIP_DIR')),
            onlyZip(requiredPath('SDK_FIXTURE_ZIP_DIR')),
            work,
            JSON.stringify(expected),
        ])
    );
    const binary = requiredPath('SDK_CHROME_BINARY');
    const driverBinary = requiredPath('SDK_CHROMEDRIVER_BINARY');
    browserBinary = binary;
    chromedriverBinary = driverBinary;
    assert(lstatSync(binary).isFile() && lstatSync(driverBinary).isFile());
    const browserVersion = run(binary, ['--version']).trim();
    const driverVersion = run(driverBinary, ['--version']).trim();
    const browserNumber = browserVersion.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
    assert(
        browserNumber &&
            browserNumber === driverVersion.match(/\d+\.\d+\.\d+\.\d+/)?.[0],
        'System Chrome/ChromeDriver versions must match; no manager/download fallback.'
    );
    receipt.browser = {
        binary,
        driverBinary,
        browserVersion,
        driverVersion,
        options: ['--headless=new', '--window-size=1440,1200'],
        sandbox: 'default, unchanged',
        certificateVerification: 'default, unchanged',
    };
    const fixture = join(work, 'fixture');
    const mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.map': 'application/json',
    };
    server = createServer((request, response) => {
        try {
            assert(request.method === 'GET' || request.method === 'HEAD');
            const url = new URL(request.url, origin);
            assert.equal(url.origin, origin);
            const path = resolve(
                fixture,
                '.' +
                    decodeURIComponent(
                        url.pathname === '/' ? '/index.html' : url.pathname
                    )
            );
            assert(within(fixture, path));
            const data = regular(path);
            response.writeHead(200, {
                'Content-Type': mime[extname(path)] ?? 'text/plain',
                'Cache-Control': 'no-store',
            });
            response.end(request.method === 'HEAD' ? undefined : data);
        } catch {
            response.writeHead(404);
            response.end('Static fixture path refused.');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    receipt.loopbackOrigin = origin;
    stage = 'browser-start';
    priorBrowserPids = new Set(browserProcesses().map((v) => v.pid));
    // Explicit installed executable/service paths avoid Selenium Manager. Only
    // standard W3C commands follow; no CDP or sandbox/certificate/security flags.
    service = new chrome.ServiceBuilder(driverBinary)
        .loggingTo(join(output, 'chromedriver.log'))
        .build();
    const options = new chrome.Options()
        .setChromeBinaryPath(binary)
        .addArguments('--headless=new', '--window-size=1440,1200');
    driver = chrome.Driver.createSession(options, service);
    const capabilities = await driver.getCapabilities();
    assert.equal(capabilities.get('acceptInsecureCerts'), false);
    receipt.browser.sessionCreated = true;
    receipt.browser.actualVersion = capabilities.get('browserVersion');
    assert.equal(receipt.browser.actualVersion, browserNumber);
    await driver
        .manage()
        .setTimeouts({ implicit: 0, pageLoad: 15000, script: 5000 });
    stage = 'cases';
    for (const surface of ['starter', 'auth'])
        for (const spec of authCases) {
            await exercise(`${surface}-${spec.id}`, async (result) => {
                await driver.get(
                    `${origin}/${surface}/index.html?scenario=${spec.id}`
                );
                await driver.wait(
                    async () =>
                        driver.executeScript(
                            'return typeof window.__privacyBrowserProof?.snapshot === "function";'
                        ),
                    10000
                );
                if (surface === 'starter') await clickText('Connect and load');
                await driver.wait(async () => {
                    const controls = await driver.findElements(
                        By.css(
                            surface === 'starter'
                                ? '#screen .fields input'
                                : '#auth-root fieldset input'
                        )
                    );
                    return controls.length === 1 &&
                        (await controls[0].isEnabled())
                        ? controls[0]
                        : false;
                }, 10000);
                const input = await find(
                    surface === 'starter'
                        ? '#screen .fields input'
                        : '#auth-root fieldset input'
                );
                await replaceInput(input, spec.value, spec.type);
                if (spec.type === 'password')
                    await noVisibleSecret(surface, spec.value);
                await capture(result, 'native-input');
                await clickText(
                    surface === 'starter' ? 'Log in and use session' : 'Log in'
                );
                const loginRoute = 'loginIntoExtensionUsingLoginPageExtension';
                const initialRoutes =
                    surface === 'starter' ? ['fetchExtensionForEndUser'] : [];
                const login = await waitSnapshot(
                    (s) =>
                        s.calls.some((v) => v.route === loginRoute) &&
                        (spec.otp
                            ? s.status?.includes('••••••••')
                            : s.status?.includes(
                                  surface === 'starter'
                                      ? 'No matching login record'
                                      : 'No login record found'
                              )),
                    'Expected actual login outcome.'
                );
                assertCalls(login, [...initialRoutes, loginRoute]);
                assert.deepEqual(login.calls.at(-1).input, {
                    extensionId: 'privacy_portal_synthetic',
                    loginCredentials: { [spec.name]: spec.value },
                });
                if (spec.type === 'password')
                    await noVisibleSecret(surface, spec.value);
                await capture(result, 'login-result');
                if (surface === 'auth')
                    assert.deepEqual(
                        (await snapshot()).events,
                        [],
                        'The recipe must not apply a session after login.'
                    );
                if (!spec.otp) return;
                assert(login.status.includes('••••••••'));
                await noVisibleSecret(surface, spec.value);
                const code = await find(
                    surface === 'starter'
                        ? '#screen input[autocomplete="one-time-code"]'
                        : '#auth-root input[autocomplete="one-time-code"]'
                );
                await replaceInput(code, '123456', 'text');
                await clickText(
                    surface === 'starter'
                        ? 'Confirm and use session'
                        : 'Confirm code'
                );
                const confirmed = await waitSnapshot(
                    (s) =>
                        s.calls.some(
                            (v) => v.route === 'confirmVerificationCodeForLogin'
                        ) &&
                        (surface === 'starter'
                            ? s.status?.includes('Login applied')
                            : s.status?.includes('Code accepted')),
                    'Expected actual confirmation outcome.'
                );
                assertCalls(confirmed, [
                    ...initialRoutes,
                    loginRoute,
                    'confirmVerificationCodeForLogin',
                ]);
                assert.deepEqual(confirmed.calls.at(-1).input, {
                    verificationId: 'verification_privacy_synthetic',
                    verificationCode: '123456',
                    language: 'en',
                });
                if (surface === 'auth') {
                    assert.equal(
                        confirmed.events.length,
                        0,
                        'Recipe must wait for explicit Apply session.'
                    );
                    await clickText('Apply session');
                    const applied = await waitSnapshot(
                        (s) =>
                            s.events.some(
                                (e) => e.type === 'explicit-session-applied'
                            ),
                        'Explicit React session application.'
                    );
                    assert.equal(
                        applied.events.filter(
                            (e) => e.type === 'explicit-session-applied'
                        ).length,
                        1
                    );
                    assertCalls(applied, [
                        loginRoute,
                        'confirmVerificationCodeForLogin',
                    ]);
                }
                await noVisibleSecret(surface, spec.value);
                await capture(result, 'confirmed');
            });
        }
    await exercise('starter-portal', async (result) => {
        await driver.get(`${origin}/starter/index.html?scenario=portal`);
        await driver.wait(
            async () =>
                driver.executeScript(
                    'return typeof window.__privacyBrowserProof?.snapshot === "function";'
                ),
            10000
        );
        await clickText('Connect and load');
        await driver.wait(
            async () =>
                (await driver.findElements(By.css('#screen select'))).length >
                0,
            10000
        );
        await clickText('Load records');
        await waitSnapshot(
            (s) => s.cells.length === 2,
            'Expected two native Portal rows.'
        );
        const row = () => find('tr[data-record-id="rec_private_synthetic"]');
        const privateCell = async () =>
            (await (await row()).findElements(By.css('td')))[1];
        const assertCells = async (secret) => {
            const state = await snapshot();
            const alpha = state.cells.find(
                (v) => v.recordId === 'rec_private_synthetic'
            );
            const empty = state.cells.find(
                (v) => v.recordId === 'rec_empty_synthetic'
            );
            assert(alpha && empty);
            assert(alpha.cells[1].text.includes('••••••••'));
            assert(
                !alpha.cells[1].text.includes(secret) &&
                    !alpha.cells[1].title.includes(secret)
            );
            assert(
                alpha.cells[2].text.includes('Ordinary public value') &&
                    !alpha.cells[2].text.includes('••••••••')
            );
            assert(!empty.cells[1].text.includes('••••••••'));
            const nativeEmpty = await find(
                'tr[data-record-id="rec_empty_synthetic"]'
            );
            const cells = await nativeEmpty.findElements(By.css('td'));
            assert.equal(
                (await cells[1].getText()).replace('Edit cell', '').trim(),
                ''
            );
            await noVisibleSecret('starter', secret);
        };
        await assertCells('Exact Case-Sensitive Original');
        await capture(result, 'loaded-cells');
        await clickText('Edit cell', await privateCell());
        const edit = await find(
            '#screen input[data-field-id="fld_secret_synthetic"]'
        );
        assert.equal(await edit.getAttribute('type'), 'password');
        assert.equal(
            await edit.getAttribute('value'),
            'Exact Case-Sensitive Original'
        );
        await replaceInput(edit, 'Different-length Saved Value', 'password');
        await capture(result, 'native-edit');
        await clickText('Save cell');
        await waitSnapshot(
            (s) => s.status?.includes('Cell saved and Portal user refreshed'),
            'Expected native Grid save and parent refresh.'
        );
        await assertCells('Different-length Saved Value');
        const saved = await capture(result, 'saved-cells');
        assertCalls(saved, [
            'fetchExtensionForEndUser',
            'fetchRecordsForLinkedTableOnPortal',
            '/api/trpc/airtable.updatePortalRecord',
            '/api/trpc/airtable.getUserRecord',
        ]);
        const mutation = saved.calls[2];
        assert.equal(mutation.method, 'POST');
        assert.deepEqual(mutation.input, {
            portalExtensionAccessToken: 'FAKE_SYNTHETIC_PORTAL_TOKEN',
            portalFieldId: 'fld_children_synthetic',
            recordFieldId: 'fld_secret_synthetic',
            recordId: 'rec_private_synthetic',
            value: 'Different-length Saved Value',
            selectedCustomViewId: 'view_privacy_synthetic',
        });
        await clickText('Edit cell', await privateCell());
        const reopened = await find(
            '#screen input[data-field-id="fld_secret_synthetic"]'
        );
        assert.equal(await reopened.getAttribute('type'), 'password');
        assert.equal(
            await reopened.getAttribute('value'),
            'Different-length Saved Value'
        );
        await capture(result, 'reopened-edit');
        await clickText(
            'Cancel',
            await (await reopened).findElement(By.xpath('ancestor::form'))
        );
        await clickText('Load records');
        await waitSnapshot(
            (s) =>
                s.calls.filter(
                    (v) => v.route === 'fetchRecordsForLinkedTableOnPortal'
                ).length === 2 && s.cells.length === 2,
            'Explicit list refresh.'
        );
        await assertCells('Different-length Saved Value');
        await clickText('Open Form', await row());
        await waitSnapshot(
            (s) => s.status === 'Record Form loaded.',
            'Expected fresh child edit Form.'
        );
        const child = await find(
            '#screen input[data-field-id="fld_secret_synthetic"]'
        );
        assert.equal(await child.getAttribute('type'), 'password');
        assert.equal(
            await child.getAttribute('value'),
            'Different-length Saved Value'
        );
        const final = await capture(result, 'fresh-child');
        assertCalls(final, [
            'fetchExtensionForEndUser',
            'fetchRecordsForLinkedTableOnPortal',
            '/api/trpc/airtable.updatePortalRecord',
            '/api/trpc/airtable.getUserRecord',
            'fetchRecordsForLinkedTableOnPortal',
            'fetchExtensionForEndUser',
        ]);
        assert.equal(
            final.calls.filter(
                (v) => v.route === '/api/trpc/airtable.updatePortalRecord'
            ).length,
            1
        );
        assert.equal(
            final.calls.at(-1).input.childExtensionInfo.childExtensionId,
            'privacy_child_synthetic'
        );
        assert.equal(
            final.calls.at(-1).input.childExtensionInfo.accessType
                .childExtensionRecordId,
            'rec_private_synthetic'
        );
        await noVisibleSecret('starter', 'Different-length Saved Value');
    });
    assert.equal(receipt.cases.length, 11);
    assert(
        receipt.cases.every((v) => v.status === 'passed'),
        'Every exact synthetic case must pass; failed cases are retained without retry.'
    );
    receipt.status = 'passed';
} catch (error) {
    receipt.status = 'failed';
    receipt.failure = {
        stage,
        category:
            stage === 'browser-start'
                ? 'browser-capability-blocker'
                : 'verification-failure',
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
    process.exitCode = 1;
} finally {
    if (driver) {
        try {
            await driver.quit();
            receipt.cleanup.webdriverQuit = true;
        } catch (error) {
            receipt.cleanup.webdriverQuit = false;
            receipt.cleanup.webdriverError = String(error);
            process.exitCode = 1;
        }
    } else receipt.cleanup.webdriverQuit = 'not-created';
    if (service) {
        try {
            await service.kill();
            receipt.cleanup.driverServiceStopped = true;
        } catch (error) {
            receipt.cleanup.driverServiceStopped = false;
            receipt.cleanup.driverServiceError = String(error);
            process.exitCode = 1;
        }
        receipt.cleanup.driverServiceRunning = service.isRunning();
        if (receipt.cleanup.driverServiceRunning) process.exitCode = 1;
    } else receipt.cleanup.driverServiceStopped = 'not-created';
    if (service && browserBinary && chromedriverBinary) {
        try {
            const remaining = () =>
                browserProcesses().filter((v) => !priorBrowserPids.has(v.pid));
            const deadline = Date.now() + 5000;
            while (remaining().length > 0 && Date.now() < deadline)
                await new Promise((resolve) => setTimeout(resolve, 100));
            receipt.cleanup.remainingNewBrowserProcesses = remaining();
            if (receipt.cleanup.remainingNewBrowserProcesses.length)
                process.exitCode = 1;
        } catch (error) {
            receipt.cleanup.processAuditError = String(error);
            process.exitCode = 1;
        }
    }
    if (server) {
        try {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
            receipt.cleanup.loopbackServerStopped = !server.listening;
            if (server.listening) process.exitCode = 1;
        } catch (error) {
            receipt.cleanup.loopbackServerStopped = false;
            receipt.cleanup.serverError = String(error);
            process.exitCode = 1;
        }
    } else receipt.cleanup.loopbackServerStopped = 'not-created';
    try {
        rmSync(work, { recursive: true, force: true });
        receipt.cleanup.ownedWorkDirectoryRemoved = !existsSync(work);
        if (existsSync(work)) process.exitCode = 1;
    } catch (error) {
        receipt.cleanup.ownedWorkDirectoryRemoved = false;
        receipt.cleanup.workDirectoryError = String(error);
        process.exitCode = 1;
    }
    receipt.finishedAt = new Date().toISOString();
    if (process.exitCode) receipt.status = 'failed';
    writeJson('run.json', receipt);
    const sums =
        readdirSync(output)
            .filter((v) => lstatSync(join(output, v)).isFile())
            .map((v) => `${sha256(readFileSync(join(output, v)))}  ${v}`)
            .join('\n') + '\n';
    writeFileSync(join(output, 'SHA256SUMS'), sums);
    console.log(
        JSON.stringify({
            status: receipt.status,
            cases: receipt.cases.map((v) => ({ id: v.id, status: v.status })),
            cleanup: receipt.cleanup,
        })
    );
}
