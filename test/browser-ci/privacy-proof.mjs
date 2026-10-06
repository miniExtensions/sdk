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
import { By, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

// This bounded job reuses these immutable push artifacts; it never rebuilds SDK.
// Native controls: shipped examples/browser/src/{main,portal}.ts and the entire
// docs/auth.md AuthPanel fence. API: selenium.dev/selenium/docs/api/javascript/
// module-selenium-webdriver_chrome-Driver.html (explicit DriverService session).
const expected = {
    packageArtifactId: '11391623783',
    packageZipSha256:
        '43ed78b1ddea42047dee4c0ec12077d75ec5241eef68f0f91412edaf5497e1c2',
    packageSha256:
        '8c92567216dbf64df89b5662cd637d475cf7d971692784d04a74901aac1ead61',
    packageBytes: 275848,
    packageFiles: 192,
    packageZipMembers: 4,
    fixtureArtifactId: '11391603719',
    fixtureZipSha256:
        '72c227d5dba543b9c22ae405c38071c9f54df75d332de69c9f46cc2052046279',
    fixtureZipMembers: 18,
    fixtureChecksums: 17,
    fixtureOutputs: 16,
    fixtureSources: 14,
    starterSdkInputs: 33,
    authSdkInputs: 7,
    source: {
        commit: 'bdd662ca4ed84f96752273069a41b0c667b9ceb0',
        tree: '149eb70bd11ff0e227214cd2b19ce884df3e6ada',
    },
    runId: '37418887500',
    runAttempt: '1',
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
package_names=unpack(package_zip,package,expected['packageZipSha256'],expected['packageZipMembers'])
fixture_names=unpack(fixture_zip,fixture,expected['fixtureZipSha256'],expected['fixtureZipMembers'])
def sums(directory,names,count):
    lines=(directory/'SHA256SUMS').read_text().splitlines(); assert len(lines)==count
    paths=[]
    for line in lines:
        match=re.fullmatch(r'([a-f0-9]{64})  (.+)',line); assert match
        digest,name=match.groups(); safe(name); assert sha((directory/name).read_bytes())==digest
        paths.append(name)
    assert len(set(paths))==len(paths)
    return paths
assert set(sums(fixture,fixture_names,expected['fixtureChecksums']))==set(fixture_names)-{'SHA256SUMS'}
sums(package,package_names,2)
receipt=json.loads((package/'artifact-receipt.json').read_text())
manifest=json.loads((fixture/'manifest.json').read_text())
for value in [receipt,manifest]:
    assert value['source']==expected['source']
    ci=value['ci']; assert ci['repository']=='miniExtensions/sdk' and ci['event']=='push'
    assert ci['runId']==expected['runId'] and ci['runAttempt']==expected['runAttempt']
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
assert len(manifest['outputs'])==expected['fixtureOutputs']
assert len({e['path'] for e in manifest['outputs']})==expected['fixtureOutputs']
for entry in manifest['outputs']:
    safe(entry['path']); check(entry,(fixture/entry['path']).read_bytes())
assert {e['path'] for e in manifest['outputs']}==set(fixture_names)-{'SHA256SUMS','manifest.json'}
assert len(manifest['sources'])==expected['fixtureSources']
assert any(e['origin']=='packed-browser-starter' and e['path']=='src/linkedFilters.ts' for e in manifest['sources'])
assert any(e['origin']=='packed-browser-starter' and e['path']=='src/choiceAvailability.ts' for e in manifest['sources'])
assert any(e['origin']=='packed-browser-starter' and e['path']=='src/review.ts' for e in manifest['sources'])
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
assert any(e['origin']=='installed-sdk-archive' and e['path']=='node_modules/@miniextensions/sdk/dist/esm/forms/visibility.js' for e in manifest['bundleInputs']['starter'])
assert any(e['origin']=='installed-sdk-archive' and e['path']=='node_modules/@miniextensions/sdk/dist/esm/forms/projection.js' for e in manifest['bundleInputs']['starter'])
assert any(e['origin']=='installed-sdk-archive' and e['path']=='node_modules/@miniextensions/sdk/dist/esm/ui/addressAutocomplete.js' for e in manifest['bundleInputs']['starter'])
for kind,count in [('starter',expected['starterSdkInputs']),('auth',expected['authSdkInputs'])]:
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
source_map=json.loads((fixture/'starter/main.js.map').read_text())
assert len(source_map['sources'])==len(source_map['sourcesContent'])
review_sources=[content for name,content in zip(source_map['sources'],source_map['sourcesContent']) if name.replace('\\','/').endswith('/src/review.ts')]
assert len(review_sources)==1
assert review_sources[0].encode()==files['package/examples/browser/src/review.ts']
print(json.dumps({'source':manifest['source'],'ci':manifest['ci'],'package':manifest['package'],
 'manifestSha256':sha((fixture/'manifest.json').read_bytes()),'fixtureFiles':len(fixture_names),
 'checksums':expected['fixtureChecksums'],'outputs':expected['fixtureOutputs'],'sources':expected['fixtureSources'],'sdkBundleInputs':sdk_counts}))
`;

const output = requiredPath('SDK_BROWSER_RESULTS_DIR');
assert(!existsSync(output), 'Refuse an existing result directory.');
assert.equal(realpathSync(dirname(output)), dirname(output));
mkdirSync(output);
const work = mkdtempSync(join(tmpdir(), 'sdk-synthetic-chromium-'));
// A fresh runner-owned profile stays inside this exact disposable work root.
const profile = join(work, 'chrome-profile');
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
        'Configured choices cover a flat Form with a visible direct scalar driver; no general hidden/linked projection credit.',
        'Additional projection cases compose conditional removal with configured choices for their declared flat physical scalar dependencies only; no section/computed/linked/lookup projection credit.',
        'Visibility cases cover their declared one-page checkbox/unsupported condition and section configurations; no multipage or general hosted parity credit.',
        'Interaction Save assertions prove native dispatch with validation responses, not durable persistence.',
        'Address cases cover editable unmasked singleLineText, a valid character cap and one optional one-page checkbox predicate; no provider/backend/general configuration credit.',
        'Address stale responses exercise combined installed SDK and starter/presenter cancellation, without independently isolating presenter generations.',
        'Review cases cover one-page manual scalar rows and explicit current Confirm only; synthetic returned validation and uncertainty handling prove no backend rule evaluation or persistence.',
        'Native modal inertness is preserved. Pending draft/owner/configuration invalidation is separately a packed real-starter event oracle, not an ordinary background native gesture claim.',
        'Empty-hiding cases cover explicit edit mode on twelve direct scalar types including richText and blocked section recovery; returned hidden-required errors are synthetic, without hosted backend validation, hidden-write authority or persistence credit. Create-mode polarity is a separate installed/packed oracle.',
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
const capture = async (caseResult, name, target = driver) => {
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
        Buffer.from(await target.takeScreenshot(), 'base64')
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
        expected.source.commit,
        /^[a-f0-9]{40}$/,
        'Root must bind the actual immutable producer before dispatch.'
    );
    assert.match(expected.source.tree, /^[a-f0-9]{40}$/);
    for (const key of ['packageZipSha256', 'fixtureZipSha256', 'packageSha256'])
        assert.match(expected[key], /^[a-f0-9]{64}$/);
    for (const key of [
        'runId',
        'runAttempt',
        'packageArtifactId',
        'fixtureArtifactId',
    ])
        assert.match(expected[key], /^\d+$/);
    for (const key of [
        'packageBytes',
        'packageFiles',
        'packageZipMembers',
        'fixtureZipMembers',
        'fixtureChecksums',
        'fixtureOutputs',
        'fixtureSources',
        'starterSdkInputs',
        'authSdkInputs',
    ])
        assert(
            Number.isSafeInteger(expected[key]) && expected[key] > 0,
            `Root must bind actual ${key}.`
        );
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
        options: [
            '--headless=new',
            '--window-size=1440,1200',
            `--user-data-dir=${profile}`,
        ],
        ownedProfileDirectory: profile,
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
        .addArguments(
            '--headless=new',
            '--window-size=1440,1200',
            `--user-data-dir=${profile}`
        );
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
    const nativeChoice = async (selector, value) => {
        const select = await find(selector);
        const option = await select.findElement(
            By.css(`option[value="${value}"]`)
        );
        assert(
            await option.isEnabled(),
            'Only an enabled native choice may be selected.'
        );
        await option.click();
        await select.sendKeys(Key.TAB);
        assert.equal(await select.getAttribute('value'), value);
    };
    const linkedCheckbox = async (title) => {
        const labels = await driver.findElements(By.css('#screen label'));
        const matches = [];
        for (const label of labels)
            if ((await label.getText()).trim() === title) matches.push(label);
        assert.equal(
            matches.length,
            1,
            'Expected one actual linked-record checkbox.'
        );
        return matches[0].findElement(By.css('input[type="checkbox"]'));
    };
    const saves = (state) =>
        state.calls.filter((call) => call.route === 'saveForm');
    const reads = (state) =>
        state.calls.filter(
            (call) => call.route === 'fetchRecordsForFormLinkedRecordsSelector'
        );
    const choiceState = (state) =>
        state.selects.find((select) => select.fieldId === 'fld_choices');
    const deniedNew = (state, name) => {
        const option = choiceState(state).options.find(
            (entry) => entry.value === name
        );
        assert(
            !option || option.disabled,
            `${name} must not be offered as a new choice.`
        );
    };
    const waitReady = (predicate, description) =>
        waitSnapshot((state) => !state.busy && predicate(state), description);
    for (const multiple of [false, true]) {
        await exercise(
            multiple ? 'starter-choice-multiple' : 'starter-choice-single',
            async (result) => {
                await driver.get(
                    `${origin}/starter/index.html?scenario=choice-${multiple ? 'multiple' : 'single'}`
                );
                await clickText('Connect and load');
                await waitReady(
                    (state) =>
                        choiceState(state) != null &&
                        state.status === 'Loaded form loaded.',
                    'Actual configured-choice Form load.'
                );
                let state = await capture(result, 'denied-native-options');
                const availability = await find(
                    '#screen [data-choice-availability-field-id="fld_choices"]'
                );
                assert.equal(
                    await availability.getAttribute('data-choice-availability'),
                    'ready'
                );
                deniedNew(state, 'Beta');
                deniedNew(state, 'Gamma');
                assert.equal(saves(state).length, 0);
                const text = await find(
                    '#screen input[data-field-id="fld_driver"]'
                );
                await replaceInput(text, 'allowed', 'text');
                const select = await find(
                    '#screen select[data-field-id="fld_choices"]'
                );
                assert.equal(
                    await select.getAttribute('multiple'),
                    multiple ? 'true' : null
                );
                const beta = await select.findElement(
                    By.css('option[value="Beta"]')
                );
                assert.equal((await beta.getText()).trim(), 'Conditional Beta');
                assert(await beta.isEnabled());
                // Native keyboard selection, followed by real focus traversal;
                // no element.value assignment or synthetic dispatchEvent.
                await select.sendKeys(Key.END, Key.TAB);
                assert.equal(await select.getAttribute('value'), 'Beta');
                state = await capture(result, 'allowed-keyboard-selection');
                assert.deepEqual(
                    choiceState(state)
                        .options.filter((entry) => entry.selected)
                        .map((entry) => entry.value),
                    ['Beta']
                );
                deniedNew(state, 'Gamma');
                assert.equal(saves(state).length, 0);
                await replaceInput(text, 'denied', 'text');
                state = await capture(result, 'retained-now-unavailable');
                assert.deepEqual(
                    choiceState(state)
                        .options.filter((entry) => entry.selected)
                        .map((entry) => entry.value),
                    ['Beta']
                );
                assert.equal(
                    choiceState(state).options.find(
                        (entry) => entry.value === 'Beta'
                    ).label,
                    'Conditional Beta'
                );
                assert.equal(
                    saves(state).length,
                    0,
                    'Driver/availability changes never save automatically.'
                );
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 1 &&
                        value.status?.includes('The Form was not saved.'),
                    'Exact native retained-choice Save/validation result.'
                );
                state = await capture(result, 'retained-native-save');
                const first = saves(state)[0];
                assert.equal(first.method, 'POST');
                assert.equal(
                    first.input.extensionAccessToken,
                    'FAKE_SYNTHETIC_INTERACTION_TOKEN'
                );
                assert.deepEqual(first.input.formRecord, {
                    type: 'edit',
                    tableId: 'tbl_interaction_synthetic',
                    recordId: 'rec_interaction_synthetic',
                    data: {
                        fld_driver: 'denied',
                        fld_choices: multiple ? ['Beta'] : 'Beta',
                    },
                });
                assert.deepEqual(
                    first.input
                        .conditionalLinkedRecordFieldIdsToFilteringValues,
                    {}
                );
                assert.deepEqual(first.input.context, { type: 'direct-url' });
                assert(
                    first.input.formFieldIdsWithUnsavedChanges.includes(
                        'fld_driver'
                    )
                );
                assert(
                    first.input.formFieldIdsWithUnsavedChanges.includes(
                        'fld_choices'
                    )
                );
                if (multiple) {
                    const retained = await (
                        await find(
                            '#screen select[data-field-id="fld_choices"]'
                        )
                    ).findElement(By.css('option[value="Beta"]'));
                    assert(
                        await retained.isEnabled(),
                        'Selected unavailable names must remain natively removable.'
                    );
                    await driver
                        .actions()
                        .keyDown(Key.CONTROL)
                        .click(retained)
                        .keyUp(Key.CONTROL)
                        .perform();
                    await (
                        await find(
                            '#screen select[data-field-id="fld_choices"]'
                        )
                    ).sendKeys(Key.TAB);
                } else
                    await (
                        await find(
                            '#screen select[data-field-id="fld_choices"]'
                        )
                    ).sendKeys(Key.HOME, Key.TAB);
                state = await capture(result, 'native-removal-denied-readd');
                assert.deepEqual(
                    choiceState(state)
                        .options.filter(
                            (entry) => entry.selected && entry.value !== ''
                        )
                        .map((entry) => entry.value),
                    []
                );
                deniedNew(state, 'Beta');
                deniedNew(state, 'Gamma');
                assert.equal(saves(state).length, 1);
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 2 &&
                        value.status?.includes('The Form was not saved.'),
                    'Native cleared-choice Save.'
                );
                state = await capture(result, 'cleared-native-save');
                assert.deepEqual(saves(state)[1].input.formRecord.data, {
                    fld_driver: 'denied',
                    fld_choices: multiple ? [] : null,
                });
                assertCalls(state, [
                    'fetchExtensionForEndUser',
                    'saveForm',
                    'saveForm',
                ]);
            }
        );
    }
    for (const multiple of [false, true]) {
        await exercise(
            multiple
                ? 'starter-choice-add-multiple'
                : 'starter-choice-add-single',
            async (result) => {
                await driver.get(
                    `${origin}/starter/index.html?scenario=choice-add-${multiple ? 'multiple' : 'single'}`
                );
                await clickText('Connect and load');
                await waitReady(
                    (state) =>
                        choiceState(state) != null &&
                        state.status === 'Loaded form loaded.',
                    'Actual Add Choice Form load.'
                );
                let state = await capture(
                    result,
                    'retained-denied-existing-choice'
                );
                assert.deepEqual(
                    choiceState(state)
                        .options.filter((entry) => entry.selected)
                        .map((entry) => entry.value),
                    ['Beta']
                );
                assert.equal(
                    choiceState(state).options.find(
                        (entry) => entry.value === 'Beta'
                    ).label,
                    'Conditional Beta'
                );
                assert.equal(
                    await (
                        await find(
                            '#screen [data-choice-availability-field-id="fld_choices"]'
                        )
                    ).getAttribute('data-choice-availability'),
                    'ready'
                );
                assert.equal(saves(state).length, 0);
                const select = await find(
                    '#screen select[data-field-id="fld_choices"]'
                );
                if (multiple) {
                    const retained = await select.findElement(
                        By.css('option[value="Beta"]')
                    );
                    assert(
                        await retained.isEnabled(),
                        'Existing denied selection must remain removable.'
                    );
                    await driver
                        .actions()
                        .keyDown(Key.CONTROL)
                        .click(retained)
                        .keyUp(Key.CONTROL)
                        .perform();
                    await select.sendKeys(Key.TAB);
                } else await select.sendKeys(Key.HOME, Key.TAB);
                state = await capture(result, 'removed-existing-choice');
                assert.deepEqual(
                    choiceState(state)
                        .options.filter(
                            (entry) => entry.selected && entry.value !== ''
                        )
                        .map((entry) => entry.value),
                    []
                );
                deniedNew(state, 'Beta');
                assert.equal(saves(state).length, 0);
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 1 &&
                        value.status?.includes('The Form was not saved.'),
                    'Native empty Save before Add Choice.'
                );
                state = await capture(
                    result,
                    'saved-empty-before-existing-choice-resolution'
                );
                const empty = {
                    fld_driver: 'denied',
                    fld_choices: multiple ? [] : null,
                };
                assert.deepEqual(saves(state)[0].input.formRecord, {
                    type: 'edit',
                    tableId: 'tbl_interaction_synthetic',
                    recordId: 'rec_interaction_synthetic',
                    data: empty,
                });
                assert.deepEqual(saves(state)[0].input.context, {
                    type: 'direct-url',
                });
                assert.deepEqual(
                    saves(state)[0].input
                        .conditionalLinkedRecordFieldIdsToFilteringValues,
                    {}
                );
                assert.deepEqual(
                    saves(state)[0].input.formFieldIdsWithUnsavedChanges,
                    ['fld_choices']
                );
                const addInput = await find(
                    '#screen input[placeholder="New choice name"]'
                );
                await replaceInput(addInput, ' bEtA ', 'text');
                await clickText('Create choice');
                const route =
                    '/api/trpc/airtable.addNewAirtableOptionForFormField';
                await waitReady(
                    (value) =>
                        value.events.some(
                            (event) => event.type === 'existing-choice-returned'
                        ) &&
                        value.calls.filter((call) => call.route === route)
                            .length === 1,
                    'Current server-equivalent existing metadata resolved.'
                );
                state = await capture(
                    result,
                    'existing-denied-choice-not-reselected'
                );
                const resolved = state.calls.filter(
                    (call) => call.route === route
                );
                assert.equal(resolved.length, 1);
                assert.equal(resolved[0].method, 'POST');
                assert.deepEqual(resolved[0].input, {
                    extensionAccessToken: 'FAKE_SYNTHETIC_INTERACTION_TOKEN',
                    airtableFieldId: 'fld_choices',
                    newChoiceText: ' bEtA ',
                });
                assert.deepEqual(
                    state.events.filter(
                        (event) => event.type === 'existing-choice-returned'
                    ),
                    [
                        {
                            type: 'existing-choice-returned',
                            choiceId: 'sel_beta',
                            choiceName: 'Beta',
                            metadataCreated: false,
                        },
                    ]
                );
                assert.deepEqual(
                    choiceState(state)
                        .options.filter(
                            (entry) => entry.selected && entry.value !== ''
                        )
                        .map((entry) => entry.value),
                    []
                );
                deniedNew(state, 'Beta');
                assert.equal(
                    saves(state).length,
                    1,
                    'Resolving an existing denied choice must not save automatically.'
                );
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 2 &&
                        value.status?.includes('The Form was not saved.'),
                    'Native empty Save after denied existing-choice resolution.'
                );
                state = await capture(
                    result,
                    'saved-empty-after-existing-choice-resolution'
                );
                assert.deepEqual(saves(state)[1].input.formRecord.data, empty);
                assert.deepEqual(
                    saves(state)[1].input.formFieldIdsWithUnsavedChanges,
                    saves(state)[0].input.formFieldIdsWithUnsavedChanges,
                    'Existing denied metadata must not change the record draft.'
                );
                assert.deepEqual(saves(state)[1].input.context, {
                    type: 'direct-url',
                });
                assert.deepEqual(
                    saves(state)[1].input
                        .conditionalLinkedRecordFieldIdsToFilteringValues,
                    {}
                );
                assertCalls(state, [
                    'fetchExtensionForEndUser',
                    'saveForm',
                    route,
                    'saveForm',
                ]);
            }
        );
    }
    await exercise('starter-linked-filter-paging', async (result) => {
        const query = new URLSearchParams({
            scenario: 'linked-filters',
            'prefill_Current country': 'North, East',
            'prefill_Current region': 'Duplicate label',
            'prefill_Current city': 'City = "One"',
        });
        await driver.get(`${origin}/starter/index.html?${query}`);
        await clickText('Connect and load');
        await waitReady(
            (state) => state.status === 'Loaded form loaded.',
            'Current linked-filter Form load.'
        );
        await clickText('Load conditional filters');
        await waitReady(
            (state) =>
                state.selects.some(
                    (select) =>
                        select.filterFieldId === 'fld_city' &&
                        select.value === 'rec_city'
                ),
            'Three actual ordered returned prefills.'
        );
        let state = await capture(result, 'ordered-prefill-pairs');
        const filters = state.calls.filter(
            (call) =>
                call.route ===
                'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
        );
        assert.deepEqual(
            filters.map((call) => ({
                id: call.input.linkedRecordsFilterFieldId,
                search: call.input.searchTerm,
                url: call.input.urlSearchValue,
                previous: call.input.filterData,
            })),
            [
                {
                    id: 'fld_country',
                    search: 'North, East',
                    url: 'North, East',
                    previous: null,
                },
                {
                    id: 'fld_region',
                    search: 'Duplicate label',
                    url: 'Duplicate label',
                    previous: {
                        previousFilterFieldId: 'fld_country',
                        previousFilterPrimaryValue: 'North, East',
                    },
                },
                {
                    id: 'fld_city',
                    search: 'City = "One"',
                    url: 'City = "One"',
                    previous: {
                        previousFilterFieldId: 'fld_region',
                        previousFilterPrimaryValue: 'Duplicate label',
                    },
                },
            ]
        );
        assert.equal(saves(state).length, 0);
        const map = {
            fld_country: state.expected.filterValues.fld_country[0],
            fld_region: state.expected.filterValues.fld_region[0],
            fld_city: state.expected.filterValues.fld_city[0],
        };
        await clickText('Search choices');
        await waitReady(
            (value) =>
                reads(value).length === 1 &&
                value.status === 'Loaded 2 allowed linked records.',
            'Native first page.'
        );
        const available = await linkedCheckbox('Available project');
        await available.sendKeys(Key.SPACE, Key.TAB);
        assert(await available.isSelected());
        await clickText('More choices');
        await waitReady(
            (value) =>
                reads(value).length === 2 &&
                value.status === 'Loaded 1 allowed linked records.',
            'Native next page with exact cursor.'
        );
        const next = await linkedCheckbox('Page two project');
        await next.sendKeys(Key.SPACE, Key.TAB);
        assert(await next.isSelected());
        state = await capture(result, 'keyboard-selection-second-page');
        assert.deepEqual(
            reads(state).map((call) => call.input.offset),
            [null, 'cursor_interaction_next']
        );
        for (const call of reads(state))
            assert.deepEqual(
                call.input.conditionalLinkedRecordFilteringValues,
                map
            );
        assert.equal(saves(state).length, 0);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Deliberate native linked-record Save.'
        );
        state = await capture(result, 'native-linked-save');
        assert.deepEqual(saves(state)[0].input.formRecord.data, {
            fld_driver: 'denied',
            fld_projects: ['rec_retained', 'rec_available', 'rec_page_two'],
        });
        assert.deepEqual(
            saves(state)[0].input
                .conditionalLinkedRecordFieldIdsToFilteringValues,
            { fld_projects: map }
        );
        await nativeChoice(
            '#screen select[data-filter-field-id="fld_country"]',
            'rec_country_south'
        );
        state = await capture(result, 'upstream-reset-retains-draft');
        for (const id of ['fld_region', 'fld_city'])
            assert.equal(
                state.selects.find((select) => select.filterFieldId === id)
                    .value,
                ''
            );
        assert.deepEqual(JSON.parse(state.linkedDraft), [
            'rec_retained',
            'rec_available',
            'rec_page_two',
        ]);
        const more = await driver.findElements(By.css('#screen button'));
        for (const button of more)
            if ((await button.getText()).trim() === 'More choices')
                assert(!(await button.isEnabled()));
        assert.equal(reads(state).length, 2);
        assert.equal(saves(state).length, 1);
        await clickText('Search choices');
        await waitReady(
            (value) =>
                reads(value).length === 3 &&
                value.status === 'Loaded 2 allowed linked records.',
            'Changed upstream filter gets a fresh first page.'
        );
        state = await capture(result, 'fresh-filter-read-no-replay');
        assert.equal(reads(state)[2].input.offset, null);
        assert.deepEqual(
            reads(state)[2].input.conditionalLinkedRecordFilteringValues,
            {
                fld_country: state.expected.filterValues.fld_country[1],
                fld_region: null,
                fld_city: null,
            }
        );
        assert.equal(saves(state).length, 1);
        assert(state.calls.every((call) => call.credentialsMode === 'omit'));
    });
    await exercise('starter-linked-filter-interruption', async (result) => {
        await driver.get(
            `${origin}/starter/index.html?scenario=linked-filter-deferred`
        );
        await clickText('Connect and load');
        await waitReady(
            (state) => state.status === 'Loaded form loaded.',
            'Deferred fixture load.'
        );
        await clickText('Load conditional filters');
        await waitReady(
            (state) =>
                state.selects.some(
                    (select) => select.filterFieldId === 'fld_country'
                ),
            'Current returned filter metadata.'
        );
        await clickText('Search Country');
        await waitSnapshot(
            (state) =>
                state.pending?.route ===
                'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
            'Actual pending primary-value read.'
        );
        await (await find('#cancel')).click();
        await clickText('Release pending synthetic read');
        await waitReady(
            (state) =>
                state.events.some((event) => event.type === 'deferred-settled'),
            'Cancelled primary read settled.'
        );
        let state = await capture(result, 'cancelled-filter-zero-effects');
        assert.equal(
            state.events.find((event) => event.type === 'deferred-settled')
                .aborted,
            true
        );
        assert.equal(
            state.selects
                .find((select) => select.filterFieldId === 'fld_country')
                .options.filter((option) => option.value !== '').length,
            0
        );
        assert.equal(saves(state).length, 0);
        assert.equal(reads(state).length, 0);
        await clickText('Search Country');
        await waitReady(
            (value) =>
                value.selects.some(
                    (select) =>
                        select.filterFieldId === 'fld_country' &&
                        select.options.length > 1
                ),
            'Fresh explicit primary read.'
        );
        await nativeChoice(
            '#screen select[data-filter-field-id="fld_country"]',
            'rec_country_north'
        );
        await clickText('Search choices');
        await waitSnapshot(
            (value) =>
                value.pending?.route ===
                'fetchRecordsForFormLinkedRecordsSelector',
            'Actual pending inner choice read.'
        );
        await nativeChoice('#visitor', 'B');
        await nativeChoice('#visitor', 'A');
        await clickText('Release pending synthetic read');
        await waitReady(
            (value) =>
                value.events.filter(
                    (event) => event.type === 'deferred-settled'
                ).length === 2,
            'Old-owner inner read settled after A-B-A.'
        );
        state = await capture(result, 'aba-read-zero-stale-effects');
        assert(
            state.events
                .filter((event) => event.type === 'deferred-settled')
                .every((event) => event.aborted)
        );
        assert.deepEqual(JSON.parse(state.linkedDraft), ['rec_retained']);
        assert.equal(
            (
                await driver.findElements(
                    By.css('#screen .choice-list input[type="checkbox"]')
                )
            ).length,
            0
        );
        assert.equal(saves(state).length, 0);
        assert.equal(reads(state).length, 1);
        await (await find('#disconnect')).click();
        state = await capture(result, 'disconnected-no-write');
        assert.equal(saves(state).length, 0);
        assert.equal(state.linkedDraft, null);
        assert(state.calls.every((call) => call.credentialsMode === 'omit'));
    });
    const visibilityControl = (state, fieldId) => {
        const control = state.visibility?.controls.find(
            (entry) => entry.fieldId === fieldId
        );
        assert(control, `Missing actual visibility control ${fieldId}.`);
        return control;
    };
    const visibilityAlert = (state) => {
        const alert = state.visibility?.alerts.find((entry) =>
            entry.text.includes('Some fields cannot be displayed')
        );
        assert(alert, 'Actual unavailable visibility alert must exist.');
        return alert;
    };
    const assertNativeVisibility = async (fieldIds, displayed) => {
        for (const fieldId of fieldIds)
            assert.equal(
                await (
                    await find(`#screen [data-field-id="${fieldId}"]`)
                ).isDisplayed(),
                displayed,
                `Actual native display mismatch for ${fieldId}.`
            );
    };
    const assertNativeVisibilityAlert = async (displayed) => {
        assert.equal(
            await (
                await find('#screen form.card > p[role="alert"]')
            ).isDisplayed(),
            displayed,
            'Actual unavailable alert display mismatch.'
        );
    };
    const assertVisibilitySave = (call, expectedData, dirtyFieldIds) => {
        assert.equal(call.method, 'POST');
        assert.equal(
            call.input.extensionAccessToken,
            'FAKE_SYNTHETIC_VISIBILITY_TOKEN'
        );
        assert.deepEqual(call.input.formRecord, {
            type: 'edit',
            tableId: 'tbl_visibility_synthetic',
            recordId: 'rec_visibility_synthetic',
            data: expectedData,
        });
        assert.deepEqual(
            [...call.input.formFieldIdsWithUnsavedChanges].sort(),
            [...dirtyFieldIds].sort()
        );
        assert.deepEqual(call.input.context, { type: 'direct-url' });
        assert.deepEqual(
            call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
            {}
        );
    };
    await exercise('starter-visibility-draft', async (result) => {
        await driver.get(
            `${origin}/starter/index.html?scenario=visibility-draft`
        );
        await clickText('Connect and load');
        await waitReady(
            (state) =>
                state.visibility?.controls.length === 5 &&
                state.status === 'Loaded form loaded.',
            'Actual one-page visibility Form load.'
        );
        let state = await capture(result, 'initial-hidden-native-values');
        const targets = [
            'fld_visibility_text',
            'fld_visibility_readonly',
            'fld_visibility_number',
        ];
        for (const id of targets) assert(visibilityControl(state, id).hidden);
        await assertNativeVisibility(targets, false);
        await assertNativeVisibility(['fld_visibility_tail'], true);
        await assertNativeVisibilityAlert(false);
        assert(!visibilityControl(state, 'fld_visibility_tail').hidden);
        assert(
            visibilityAlert(state).hidden,
            'A supported false predicate is ordinary hidden presentation, not unavailable.'
        );
        assert.equal(saves(state).length, 0);
        const toggle = await find(
            '#screen input[data-field-id="fld_visibility_driver"]'
        );
        assert.equal(await toggle.getAttribute('type'), 'checkbox');
        assert(!(await toggle.isSelected()));
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'keyboard-reveal-focus');
        assert(visibilityControl(state, 'fld_visibility_driver').value);
        for (const id of targets) assert(!visibilityControl(state, id).hidden);
        await assertNativeVisibility(targets, true);
        assert.equal(state.visibility.activeFieldId, 'fld_visibility_text');
        assert(visibilityControl(state, 'fld_visibility_readonly').disabled);
        const text = await find(
            '#screen input[data-field-id="fld_visibility_text"]'
        );
        await replaceInput(text, 'Accepted conditional draft', 'text');
        const number = await find(
            '#screen input[data-field-id="fld_visibility_number"]'
        );
        assert.equal(await number.getAttribute('type'), 'number');
        await number.clear();
        await number.sendKeys('1');
        state = await capture(result, 'accepted-native-number');
        assert.equal(
            visibilityControl(state, 'fld_visibility_number').value,
            '1'
        );
        assert(visibilityControl(state, 'fld_visibility_number').valid);
        // Append an incomplete exponent using the actual native input. Observe
        // badInput in Chrome; do not assign a value or dispatch an input event.
        await number.sendKeys('e');
        state = await capture(result, 'visible-native-bad-input');
        assert(
            visibilityControl(state, 'fld_visibility_number').badInput,
            'The actual native keyboard sequence must establish badInput.'
        );
        assert(!visibilityControl(state, 'fld_visibility_number').valid);
        assert.equal(saves(state).length, 0);
        await clickText('Save');
        await waitReady(
            (value) =>
                value.status === 'Conditional number must be a valid number.' &&
                saves(value).length === 0,
            'Visible invalid number must stop before Save dispatch.'
        );
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'keyboard-hide-skips-target-focus');
        assert.equal(
            visibilityControl(state, 'fld_visibility_driver').value,
            false
        );
        for (const id of targets) assert(visibilityControl(state, id).hidden);
        await assertNativeVisibility(targets, false);
        assert(visibilityControl(state, 'fld_visibility_number').badInput);
        assert.equal(
            state.visibility.activeFieldId,
            'fld_visibility_tail',
            'Hidden and disabled targets must not receive native TAB focus.'
        );
        assert.equal(saves(state).length, 0);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Explicit hidden invalid-control Save dispatch uses complete accepted draft.'
        );
        state = await capture(result, 'saved-complete-hidden-native-draft');
        const accepted = {
            ...state.expected.initial,
            fld_visibility_driver: false,
            fld_visibility_text: 'Accepted conditional draft',
            fld_visibility_number: 1,
        };
        const dirty = [
            'fld_visibility_driver',
            'fld_visibility_text',
            'fld_visibility_number',
        ];
        assertVisibilitySave(saves(state)[0], accepted, dirty);
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(
            result,
            'reveal-retains-accepted-text-and-invalid-control'
        );
        assert.equal(
            visibilityControl(state, 'fld_visibility_text').value,
            'Accepted conditional draft'
        );
        assert(visibilityControl(state, 'fld_visibility_number').badInput);
        assert.equal(saves(state).length, 1);
        // Use native editing keys to clear the browser's incomplete-input
        // buffer even when the reflected value is already the empty string.
        await number.sendKeys(
            Key.chord(Key.CONTROL, 'a'),
            Key.BACK_SPACE,
            '2',
            Key.TAB
        );
        state = await capture(result, 'native-number-repair');
        assert(visibilityControl(state, 'fld_visibility_number').valid);
        assert.equal(
            visibilityControl(state, 'fld_visibility_number').value,
            '2'
        );
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 2 &&
                value.status?.includes('The Form was not saved.'),
            'Explicit repaired visible-control Save dispatch.'
        );
        state = await capture(result, 'saved-repaired-native-draft');
        assertVisibilitySave(
            saves(state)[1],
            {
                ...accepted,
                fld_visibility_driver: true,
                fld_visibility_number: 2,
            },
            dirty
        );
        assertCalls(state, [
            'fetchExtensionForEndUser',
            'saveForm',
            'saveForm',
        ]);
    });
    await exercise('starter-visibility-unavailable', async (result) => {
        await driver.get(
            `${origin}/starter/index.html?scenario=visibility-unavailable`
        );
        await clickText('Connect and load');
        await waitReady(
            (state) =>
                state.visibility?.controls.length === 3 &&
                state.status === 'Loaded form loaded.',
            'Actual unsupported published visibility Form load.'
        );
        let state = await capture(result, 'unsupported-explicit-unavailable');
        assert(visibilityControl(state, 'fld_visibility_text').hidden);
        assert(!visibilityControl(state, 'fld_visibility_tail').hidden);
        assert(
            !visibilityAlert(state).hidden,
            'Unsupported condition must be explicit unavailable, not ordinary false.'
        );
        await assertNativeVisibility(['fld_visibility_text'], false);
        await assertNativeVisibility(['fld_visibility_tail'], true);
        await assertNativeVisibilityAlert(true);
        assert.equal(saves(state).length, 0);
        await replaceInput(
            await find('#screen input[data-field-id="fld_visibility_tail"]'),
            'Accepted adjacent draft',
            'text'
        );
        await clickText('Save');
        await waitReady(
            (value) =>
                value.status ===
                    'Review the unavailable fields before saving this Form.' &&
                saves(value).length === 0,
            'Unavailable predicate stops native Save dispatch.'
        );
        state = await capture(
            result,
            'blocked-submit-retains-adjacent-native-edit'
        );
        assert.equal(
            visibilityControl(state, 'fld_visibility_tail').value,
            'Accepted adjacent draft'
        );
        assert.equal(
            visibilityControl(state, 'fld_visibility_text').value,
            state.expected.initial.fld_visibility_text
        );
        assertCalls(state, ['fetchExtensionForEndUser']);
        await (await find('#reload')).click();
        await waitReady(
            (value) =>
                value.events.filter(
                    (event) => event.type === 'visibility-root-response'
                ).length === 2 &&
                value.status === 'Loaded form loaded.' &&
                !visibilityControl(value, 'fld_visibility_text').hidden,
            'Fresh native Reload supplies supported published visibility.'
        );
        state = await capture(result, 'fresh-supported-reload-recovers');
        assert(visibilityAlert(state).hidden);
        await assertNativeVisibility(
            ['fld_visibility_text', 'fld_visibility_tail'],
            true
        );
        await assertNativeVisibilityAlert(false);
        assert.equal(
            visibilityControl(state, 'fld_visibility_tail').value,
            state.expected.initial.fld_visibility_tail,
            'Fresh explicit Reload replaces the rejected old draft with newly read native values.'
        );
        assert.deepEqual(
            state.events
                .filter((event) => event.type === 'visibility-root-response')
                .map((event) => event.condition),
            ['unsupported-singleSelect', 'supported-checkbox']
        );
        assert.equal(saves(state).length, 0);
        await replaceInput(
            await find('#screen input[data-field-id="fld_visibility_text"]'),
            'Fresh supported draft',
            'text'
        );
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Supported freshly loaded visibility permits deliberate native Save.'
        );
        state = await capture(result, 'fresh-supported-native-save');
        assertVisibilitySave(
            saves(state)[0],
            {
                ...state.expected.initial,
                fld_visibility_text: 'Fresh supported draft',
            },
            ['fld_visibility_text']
        );
        assertCalls(state, [
            'fetchExtensionForEndUser',
            'fetchExtensionForEndUser',
            'saveForm',
        ]);
    });
    await exercise('starter-visibility-section', async (result) => {
        await driver.get(
            `${origin}/starter/index.html?scenario=visibility-section`
        );
        await clickText('Connect and load');
        await waitReady(
            (state) =>
                state.visibility?.controls.length === 5 &&
                state.status === 'Loaded form loaded.',
            'Actual one-page section visibility Form load.'
        );
        let state = await capture(
            result,
            'hidden-lead-follower-visible-reset-section'
        );
        for (const id of ['fld_visibility_lead', 'fld_visibility_follower'])
            assert(visibilityControl(state, id).hidden);
        await assertNativeVisibility(
            ['fld_visibility_lead', 'fld_visibility_follower'],
            false
        );
        await assertNativeVisibility(
            ['fld_visibility_reset', 'fld_visibility_tail'],
            true
        );
        for (const id of ['fld_visibility_reset', 'fld_visibility_tail'])
            assert(!visibilityControl(state, id).hidden);
        assert(visibilityAlert(state).hidden);
        const toggle = await find(
            '#screen input[data-field-id="fld_visibility_driver"]'
        );
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'native-section-reveal-focus');
        for (const id of ['fld_visibility_lead', 'fld_visibility_follower'])
            assert(!visibilityControl(state, id).hidden);
        await assertNativeVisibility(
            ['fld_visibility_lead', 'fld_visibility_follower'],
            true
        );
        assert.equal(state.visibility.activeFieldId, 'fld_visibility_lead');
        await replaceInput(
            await find(
                '#screen input[data-field-id="fld_visibility_follower"]'
            ),
            'Accepted section follower',
            'text'
        );
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'native-section-hide-reset-focus');
        for (const id of ['fld_visibility_lead', 'fld_visibility_follower'])
            assert(visibilityControl(state, id).hidden);
        await assertNativeVisibility(
            ['fld_visibility_lead', 'fld_visibility_follower'],
            false
        );
        await assertNativeVisibility(
            ['fld_visibility_reset', 'fld_visibility_tail'],
            true
        );
        for (const id of ['fld_visibility_reset', 'fld_visibility_tail'])
            assert(!visibilityControl(state, id).hidden);
        assert.equal(state.visibility.activeFieldId, 'fld_visibility_reset');
        assert.equal(
            saves(state).length,
            0,
            'Section presentation changes never save automatically.'
        );
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Deliberate hidden section native Save.'
        );
        state = await capture(result, 'saved-complete-native-hidden-section');
        assertVisibilitySave(
            saves(state)[0],
            {
                ...state.expected.initial,
                fld_visibility_follower: 'Accepted section follower',
            },
            ['fld_visibility_driver', 'fld_visibility_follower']
        );
        assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
    });
    const addressFieldId = 'fld_address_synthetic';
    const addressSelector = `#screen input[data-field-id="${addressFieldId}"]`;
    const addressPresenterSelector = '#screen [data-ui="address-autocomplete"]';
    const predictionRoute =
        '/api/trpc/publicExtensions.autoCompleteAddressField';
    const detailRoute =
        '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId';
    const addressReads = (state, route) =>
        state.calls.filter((call) => call.route === route);
    const addressControl = (state) => {
        const control = state.address?.controls.find(
            (entry) => entry.fieldId === addressFieldId
        );
        assert(control, 'Actual native address input must exist.');
        return control;
    };
    const addressPresenter = (state) => {
        assert.equal(state.address?.presenters.length, 1);
        return state.address.presenters[0];
    };
    const capped = (state, value) =>
        value.slice(0, state.expected.characterLimit);
    const addressPending = (state, kind) =>
        state.pending.find((entry) => entry.kind === kind);
    const addressSettled = (state, id) =>
        state.events.find(
            (event) =>
                event.type === 'address-response-settled' && event.id === id
        );
    const assertAddressQuiet = (state, value) => {
        assert.equal(addressControl(state).value, value);
        const presenter = addressPresenter(state);
        assert.deepEqual(presenter.options, []);
        assert.equal(presenter.expanded, 'false');
        assert.equal(presenter.activeDescendant, null);
        assert.equal(presenter.status, '');
        assert.equal(presenter.statusRole, 'status');
        assert.equal(presenter.retryHidden, true);
    };
    const assertAddressPopupClosed = async (result, name) => {
        const current = await find(addressPresenterSelector);
        const suggestions = await current.findElements(
            By.css('[data-address-suggestions]')
        );
        const attributions = await current.findElements(
            By.css('[data-address-attribution]')
        );
        const logos = await current.findElements(
            By.css('img[alt="Google Maps"]')
        );
        assert.equal(suggestions.length, 1);
        assert.equal(attributions.length, 1);
        assert.equal(logos.length, 1);
        const listbox = await suggestions[0].findElement(
            By.css('[role="listbox"]')
        );
        const visible = {
            suggestions: await suggestions[0].isDisplayed(),
            listbox: await listbox.isDisplayed(),
            attribution: await attributions[0].isDisplayed(),
            logo: await logos[0].isDisplayed(),
        };
        const expanded = await (
            await find(addressSelector)
        ).getAttribute('aria-expanded');
        result.observations.push({
            stage: `${name}-native-popup-closed`,
            fieldId: addressFieldId,
            expanded,
            visible,
        });
        assert.equal(expanded, 'false');
        assert.deepEqual(visible, {
            suggestions: false,
            listbox: false,
            attribution: false,
            logo: false,
        });
    };
    const assertAddressSave = (call, state, data, dirtyFieldIds) => {
        assert.equal(call.method, 'POST');
        assert.equal(
            call.input.extensionAccessToken,
            'FAKE_SYNTHETIC_ADDRESS_TOKEN'
        );
        assert.deepEqual(call.input.formRecord, {
            type: 'edit',
            tableId: state.expected.tableId,
            recordId: state.expected.recordId,
            data,
        });
        assert.deepEqual(
            [...call.input.formFieldIdsWithUnsavedChanges].sort(),
            [...dirtyFieldIds].sort()
        );
        assert.deepEqual(call.input.context, { type: 'direct-url' });
        assert.deepEqual(
            call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
            {}
        );
    };
    const assertAddressReadInputs = (state, queries, places) => {
        assert.deepEqual(
            addressReads(state, predictionRoute).map((call) => ({
                method: call.method,
                input: call.input,
            })),
            queries.map((addressFieldValue) => ({
                method: 'GET',
                input: {
                    extensionAccessToken: 'FAKE_SYNTHETIC_ADDRESS_TOKEN',
                    fieldId: addressFieldId,
                    addressFieldValue,
                },
            }))
        );
        assert.deepEqual(
            addressReads(state, detailRoute).map((call) => ({
                method: call.method,
                input: call.input,
            })),
            places.map((placeId) => ({
                method: 'GET',
                input: {
                    extensionAccessToken: 'FAKE_SYNTHETIC_ADDRESS_TOKEN',
                    fieldId: addressFieldId,
                    placeId,
                },
            }))
        );
    };
    const observeAddressCalls = async (routes) => {
        // Cross the presenter's 800ms debounce window while repeatedly reading
        // the real trace. This catches blank queries and automatic retries.
        const until = Date.now() + 900;
        return driver.wait(
            async () => {
                const state = await snapshot();
                assertCalls(state, routes);
                return Date.now() >= until ? state : false;
            },
            2500,
            'Bounded address trace remains exact across the debounce window.',
            100
        );
    };
    const loadAddress = async (scenario) => {
        await driver.get(`${origin}/starter/index.html?scenario=${scenario}`);
        await clickText('Connect and load');
        await waitReady(
            (state) =>
                state.address?.presenters.length === 1 &&
                state.status === 'Loaded form loaded.' &&
                !addressControl(state).disabled,
            'Actual packed configured address Form load.'
        );
        const input = await find(addressSelector);
        assert.equal(await input.getAttribute('type'), 'text');
        assert.equal(await input.getAttribute('role'), 'combobox');
        assert.equal(await input.getAttribute('autocomplete'), 'off');
        return input;
    };
    const typeAddress = async (input, value) => {
        assert(await input.isDisplayed());
        assert(await input.isEnabled());
        await input.clear();
        await input.sendKeys(value);
        const state = await snapshot();
        assert.equal(await input.getAttribute('value'), capped(state, value));
        assert.equal(addressControl(state).value, capped(state, value));
    };
    const waitAddressPending = (kind) =>
        waitSnapshot(
            (state) => addressPending(state, kind),
            `Actual synthetic address ${kind} request has started.`
        );
    const settleAddress = async (kind, id, failure = false) => {
        await clickText(`${failure ? 'Fail' : 'Release'} address ${kind}`);
        const state = await waitSnapshot(
            (value) => addressSettled(value, id),
            `Already-started synthetic address ${kind} response settled.`
        );
        assert.equal(
            addressSettled(state, id).outcome,
            failure ? 'failure' : 'success'
        );
        if (failure)
            await waitReady(
                (value) =>
                    addressPresenter(value).statusRole === 'alert' &&
                    !addressPresenter(value).retryHidden,
                'The actual failed address read exposes its local retry.'
            );
        return state;
    };
    const assertNativeColor = (actual, hex, channels, alpha = 1) => {
        const expectedColors = [
            hex,
            `rgba(${channels.join(', ')}, ${alpha})`,
            ...(alpha === 1 ? [`rgb(${channels.join(', ')})`] : []),
        ];
        assert(
            expectedColors.includes(actual.toLowerCase()),
            `Unexpected native computed color ${actual}; expected ${hex}.`
        );
    };
    const addressOptions = async (result) => {
        const state = await waitReady(
            (value) => addressPresenter(value).options.length === 2,
            'Actual prediction options rendered without making Form busy.'
        );
        assert.deepEqual(
            addressPresenter(state).options.map((option) => option.label),
            state.expected.predictions.map(
                (prediction) => prediction.description
            )
        );
        assert(
            addressPresenter(state).options.every(
                (option) => !option.hidden && !option.disabled
            )
        );
        assert.equal(addressPresenter(state).expanded, 'true');
        const options = await driver.findElements(
            By.css(`${addressPresenterSelector} [role="option"]`)
        );
        assert.equal(options.length, 2);
        for (const option of options) {
            assert(await option.isDisplayed());
            assert(await option.isEnabled());
            assert.equal((await option.findElements(By.css('*'))).length, 0);
        }
        const suggestions = await find(
            `${addressPresenterSelector} [data-address-suggestions]`
        );
        const listbox = await suggestions.findElement(
            By.css('[role="listbox"]')
        );
        const attributions = await suggestions.findElements(
            By.css('[data-address-attribution]')
        );
        assert.equal(attributions.length, 1);
        const attribution = attributions[0];
        const logos = await attribution.findElements(
            By.css('img[alt="Google Maps"]')
        );
        assert.equal(logos.length, 1);
        const logo = logos[0];
        assert(await suggestions.isDisplayed());
        assert(await listbox.isDisplayed());
        assert(await attribution.isDisplayed());
        assert(await logo.isDisplayed());
        assert.equal((await listbox.findElements(By.css('img'))).length, 0);
        assert.equal(
            await (await listbox.findElement(By.xpath('..'))).getId(),
            await suggestions.getId(),
            'Predictions must share the same visible attribution container.'
        );
        assert.equal(
            await (await attribution.findElement(By.xpath('..'))).getId(),
            await suggestions.getId(),
            'Attribution must be a sibling of the actual listbox.'
        );
        assert.equal(await logo.getAttribute('alt'), 'Google Maps');
        assert.equal(await logo.getDomAttribute('translate'), 'no');
        assert.equal(await attribution.getDomAttribute('translate'), 'no');
        await driver.wait(
            async () => (await logo.getProperty('complete')) === true,
            5000,
            'The actual embedded provider attribution image completes.'
        );
        const intrinsic = {
            width: Number(await logo.getProperty('naturalWidth')),
            height: Number(await logo.getProperty('naturalHeight')),
        };
        assert.deepEqual(intrinsic, { width: 196, height: 36 });
        const src = await logo.getAttribute('src');
        const prefix = 'data:image/png;base64,';
        assert(src.startsWith(prefix));
        const png = Buffer.from(src.slice(prefix.length), 'base64');
        assert.equal(png.length, 2600);
        const logoSha256 = sha256(png);
        assert.equal(
            logoSha256,
            'f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c'
        );
        const logoRect = await logo.getRect();
        const attributionRect = await attribution.getRect();
        assert(Math.abs(logoRect.width - 98) <= 0.1);
        assert(Math.abs(logoRect.height - 18) <= 0.1);
        assert.equal(await logo.getCssValue('width'), '98px');
        assert.equal(await logo.getCssValue('height'), '18px');
        const padding = {};
        for (const [side, pixels] of [
            ['top', 10],
            ['right', 10],
            ['bottom', 5],
            ['left', 10],
        ]) {
            padding[side] = await attribution.getCssValue(`padding-${side}`);
            assert.equal(padding[side], `${pixels}px`);
        }
        const clearspace = {
            top: logoRect.y - attributionRect.y,
            right:
                attributionRect.x +
                attributionRect.width -
                (logoRect.x + logoRect.width),
            bottom:
                attributionRect.y +
                attributionRect.height -
                (logoRect.y + logoRect.height),
            left: logoRect.x - attributionRect.x,
        };
        for (const [side, minimum] of [
            ['top', 10],
            ['right', 10],
            ['bottom', 5],
            ['left', 10],
        ])
            assert(
                clearspace[side] >= minimum - 0.1,
                `Actual provider logo ${side} clearspace must be at least ${minimum}px.`
            );
        const suggestionsBackground =
            await suggestions.getCssValue('background-color');
        const attributionBackground =
            await attribution.getCssValue('background-color');
        assertNativeColor(suggestionsBackground, '#ffffff', [255, 255, 255]);
        assertNativeColor(attributionBackground, '#ffffff', [255, 255, 255]);
        const border = {};
        for (const side of ['top', 'right', 'bottom', 'left']) {
            border[side] = {
                width: await suggestions.getCssValue(`border-${side}-width`),
                style: await suggestions.getCssValue(`border-${side}-style`),
                color: await suggestions.getCssValue(`border-${side}-color`),
            };
            assert(parseFloat(border[side].width) > 0);
            assert.equal(border[side].style, 'solid');
            assertNativeColor(border[side].color, '#6b7280', [107, 114, 128]);
        }
        result.observations.push({
            stage: 'native-provider-attribution',
            alt: await logo.getAttribute('alt'),
            complete: await logo.getProperty('complete'),
            logoBytes: png.length,
            logoSha256,
            intrinsic,
            logoRect,
            attributionRect,
            padding,
            clearspace,
            suggestionsBackground,
            attributionBackground,
            border,
        });
        return options;
    };
    const assertNativeAddressHighlight = async (
        result,
        input,
        options,
        highlighted,
        query,
        name
    ) => {
        const paints = [];
        for (const option of options) {
            const paint = {
                id: await option.getAttribute('id'),
                selected: await option.getAttribute('aria-selected'),
                background: await option.getCssValue('background-color'),
                color: await option.getCssValue('color'),
                outlineColor: await option.getCssValue('outline-color'),
                outlineStyle: await option.getCssValue('outline-style'),
                outlineWidth: await option.getCssValue('outline-width'),
                outlineOffset: await option.getCssValue('outline-offset'),
                rect: await option.getRect(),
                displayed: await option.isDisplayed(),
            };
            paints.push(paint);
        }
        const activeElement = await driver.switchTo().activeElement();
        const nativeActiveInputId = await activeElement.getAttribute('id');
        const targetSelector = `${addressPresenterSelector} [data-address-suggestions]`;
        const suggestions = await find(targetSelector);
        const observation = {
            stage: `${name}-native-computed-paint`,
            nativeActiveInputId,
            paints,
            screenshot: {
                mode: 'w3c-element',
                targetSelector,
                targetElementId: await suggestions.getId(),
                targetRect: await suggestions.getRect(),
            },
        };
        result.observations.push(observation);
        await capture(result, name, suggestions);
        const state = await snapshot();
        const activeAfterScreenshot = await driver.switchTo().activeElement();
        observation.afterScreenshot = {
            snapshot: state,
            nativeActiveInputId: await activeAfterScreenshot.getAttribute('id'),
        };
        assert.equal(await activeElement.getId(), await input.getId());
        assert.equal(nativeActiveInputId, await input.getAttribute('id'));
        assert.equal(await activeAfterScreenshot.getId(), await input.getId());
        assert.equal(
            observation.afterScreenshot.nativeActiveInputId,
            await input.getAttribute('id')
        );
        assert(addressControl(state).focused);
        assert.equal(addressControl(state).value, query);
        assert.equal(addressPresenter(state).expanded, 'true');
        assert.equal(
            addressPresenter(state).activeDescendant,
            paints[highlighted].id
        );
        assert.deepEqual(
            addressPresenter(state).options.map((option) => option.selected),
            paints.map((_, index) => index === highlighted)
        );
        for (let index = 0; index < paints.length; index += 1) {
            const paint = paints[index];
            const selected = index === highlighted;
            assert.equal(paint.selected, String(selected));
            assert(paint.displayed && paint.rect.height > 0);
            assertNativeColor(
                paint.background,
                selected ? '#1d4ed8' : '#ffffff',
                selected ? [29, 78, 216] : [255, 255, 255]
            );
            assertNativeColor(
                paint.color,
                selected ? '#ffffff' : '#1f2937',
                selected ? [255, 255, 255] : [31, 41, 55]
            );
            assertNativeColor(
                paint.outlineColor,
                selected ? '#111827' : 'transparent',
                selected ? [17, 24, 39] : [0, 0, 0],
                selected ? 1 : 0
            );
            assert.equal(paint.outlineStyle, 'solid');
            assert.equal(paint.outlineWidth, '2px');
            assert.equal(paint.outlineOffset, '-2px');
        }
        assert.equal(saves(state).length, 0);
        assertAddressReadInputs(state, [query], []);
        assertCalls(state, ['fetchExtensionForEndUser', predictionRoute]);
    };
    const assertAddressFailure = async (state, value) => {
        assert.equal(addressControl(state).value, value);
        const presenter = addressPresenter(state);
        assert.deepEqual(presenter.options, []);
        assert.equal(presenter.expanded, 'false');
        assert.equal(presenter.statusRole, 'alert');
        assert.equal(
            presenter.status,
            'Address suggestions could not be loaded. You can keep typing manually or try again.'
        );
        assert.equal(presenter.retryHidden, false);
        assert.equal(presenter.retryDisabled, false);
        assert(
            !(await (await applicationText('starter')).getText()).includes(
                'Synthetic unavailable'
            )
        );
        const retry = await find(
            `${addressPresenterSelector} > button:last-child`
        );
        assert(await retry.isDisplayed());
        assert(await retry.isEnabled());
    };
    await exercise('starter-address-acceptance', async (result) => {
        const input = await loadAddress('address-acceptance');
        let state = await capture(result, 'loaded-native-address');
        assertAddressQuiet(state, state.expected.initial[addressFieldId]);
        assertCalls(state, ['fetchExtensionForEndUser']);
        const manual = 'Manual native address exceeds cap';
        await typeAddress(input, manual);
        state = await waitAddressPending('predictions');
        const predictionId = addressPending(state, 'predictions').id;
        state = await capture(result, 'native-capped-manual-debounced-query');
        assert.equal(addressControl(state).value, capped(state, manual));
        assert(addressControl(state).focused);
        assert.equal(state.busy, false);
        assert.equal(state.address.screenInert, false);
        assert.equal(saves(state).length, 0);
        assertAddressReadInputs(state, [capped(state, manual)], []);
        await settleAddress('predictions', predictionId);
        const options = await addressOptions(result);
        await input.sendKeys(Key.ARROW_DOWN);
        await assertNativeAddressHighlight(
            result,
            input,
            options,
            0,
            capped(state, manual),
            'keyboard-first-option-visible-highlight'
        );
        await input.sendKeys(Key.ARROW_DOWN);
        await assertNativeAddressHighlight(
            result,
            input,
            options,
            1,
            capped(state, manual),
            'keyboard-second-option-resets-first-highlight'
        );
        await input.sendKeys(Key.ARROW_UP);
        await assertNativeAddressHighlight(
            result,
            input,
            options,
            0,
            capped(state, manual),
            'keyboard-up-restores-first-resets-second-highlight'
        );
        await input.sendKeys(Key.ENTER);
        state = await waitAddressPending('details');
        const detailId = addressPending(state, 'details').id;
        const selected = capped(
            state,
            state.expected.predictions[0].description
        );
        state = await capture(
            result,
            'keyboard-selected-description-immediate'
        );
        assert.equal(addressControl(state).value, selected);
        assert(addressControl(state).focused);
        assert.deepEqual(addressPresenter(state).options, []);
        assert.equal(addressPresenter(state).expanded, 'false');
        await assertAddressPopupClosed(result, 'accepted-description');
        assert.equal(
            addressPresenter(state).status,
            'Loading selected address…'
        );
        assert.equal(saves(state).length, 0);
        await settleAddress('details', detailId);
        const formatted = capped(state, state.expected.formatted);
        await waitReady(
            (value) => addressControl(value).value === formatted,
            'Current formatted native address accepted with the same cap.'
        );
        state = await capture(result, 'accepted-capped-format-no-autosave');
        assertAddressQuiet(state, formatted);
        assert.equal(saves(state).length, 0);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Deliberate formatted native Save validation.'
        );
        state = await capture(result, 'complete-formatted-native-save');
        assertAddressSave(
            saves(state)[0],
            state,
            {
                ...state.expected.initial,
                [addressFieldId]: formatted,
            },
            [addressFieldId]
        );
        await clickText('Clear address', await find(addressPresenterSelector));
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
            detailRoute,
            'saveForm',
        ]);
        state = await capture(result, 'native-clear-null-no-blank-query');
        assertAddressQuiet(state, '');
        await assertAddressPopupClosed(result, 'cleared-address');
        assert(addressControl(state).focused);
        assert.equal(saves(state).length, 1);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 2 &&
                value.status?.includes('The Form was not saved.'),
            'Deliberate cleared native Save validation.'
        );
        state = await capture(result, 'complete-null-native-save');
        assertAddressSave(
            saves(state)[1],
            state,
            {
                ...state.expected.initial,
                [addressFieldId]: null,
            },
            [addressFieldId]
        );
        assertAddressReadInputs(
            state,
            [capped(state, manual)],
            ['place_address_one']
        );
        assertCalls(state, [
            'fetchExtensionForEndUser',
            predictionRoute,
            detailRoute,
            'saveForm',
            'saveForm',
        ]);
        assert.deepEqual(state.pending, []);
        assert.deepEqual(state.address.abortCounts, {
            predictions: 0,
            details: 0,
            save: 0,
        });
    });
    await exercise('starter-address-failure-retry', async (result) => {
        const input = await loadAddress('address-failure');
        const manual = 'Manual fallback';
        await typeAddress(input, manual);
        let state = await waitAddressPending('predictions');
        await settleAddress(
            'predictions',
            addressPending(state, 'predictions').id,
            true
        );
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
        ]);
        state = await capture(result, 'failed-prediction-retains-manual-draft');
        await assertAddressFailure(state, manual);
        await assertAddressPopupClosed(result, 'prediction-failure');
        assert.equal(saves(state).length, 0);
        assertAddressReadInputs(state, [manual], []);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Explicit manual fallback can dispatch native Save.'
        );
        state = await capture(result, 'manual-fallback-native-save');
        assertAddressSave(
            saves(state)[0],
            state,
            {
                ...state.expected.initial,
                [addressFieldId]: manual,
            },
            [addressFieldId]
        );
        const retryManual = 'Retry manual';
        await typeAddress(input, retryManual);
        state = await waitAddressPending('predictions');
        await settleAddress(
            'predictions',
            addressPending(state, 'predictions').id,
            true
        );
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
            'saveForm',
            predictionRoute,
        ]);
        state = await capture(
            result,
            'new-prediction-failure-awaits-explicit-retry'
        );
        await assertAddressFailure(state, retryManual);
        await assertAddressPopupClosed(result, 'retry-prediction-failure');
        assertAddressReadInputs(state, [manual, retryManual], []);
        assert.equal(saves(state).length, 1);
        await clickText('Try again', await find(addressPresenterSelector));
        state = await waitAddressPending('predictions');
        assertAddressReadInputs(state, [manual, retryManual, retryManual], []);
        await settleAddress(
            'predictions',
            addressPending(state, 'predictions').id
        );
        const options = await addressOptions(result);
        await options[0].click();
        state = await waitAddressPending('details');
        const selected = capped(
            state,
            state.expected.predictions[0].description
        );
        assert.equal(addressControl(state).value, selected);
        assert(addressControl(state).focused);
        await settleAddress(
            'details',
            addressPending(state, 'details').id,
            true
        );
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
            'saveForm',
            predictionRoute,
            predictionRoute,
            detailRoute,
        ]);
        state = await capture(
            result,
            'failed-detail-retains-selected-native-draft'
        );
        await assertAddressFailure(state, selected);
        await assertAddressPopupClosed(result, 'detail-failure');
        assert.equal(saves(state).length, 1);
        assertAddressReadInputs(
            state,
            [manual, retryManual, retryManual],
            ['place_address_one']
        );
        await clickText('Try again', await find(addressPresenterSelector));
        state = await waitAddressPending('details');
        assertAddressReadInputs(
            state,
            [manual, retryManual, retryManual],
            ['place_address_one', 'place_address_one']
        );
        await settleAddress('details', addressPending(state, 'details').id);
        const formatted = capped(state, state.expected.formatted);
        await waitReady(
            (value) => addressControl(value).value === formatted,
            'Explicit same-place detail retry accepts current formatting.'
        );
        state = await capture(result, 'retry-formatted-value-no-autosave');
        assertAddressQuiet(state, formatted);
        assert.equal(saves(state).length, 1);
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 2 &&
                value.status?.includes('The Form was not saved.'),
            'Explicit post-retry native Save validation.'
        );
        state = await capture(result, 'complete-post-retry-native-save');
        assertAddressSave(
            saves(state)[1],
            state,
            {
                ...state.expected.initial,
                [addressFieldId]: formatted,
            },
            [addressFieldId]
        );
        assertCalls(state, [
            'fetchExtensionForEndUser',
            predictionRoute,
            'saveForm',
            predictionRoute,
            predictionRoute,
            detailRoute,
            detailRoute,
            'saveForm',
        ]);
        assert.deepEqual(state.pending, []);
        assert.deepEqual(state.address.abortCounts, {
            predictions: 0,
            details: 0,
            save: 0,
        });
    });
    await exercise('starter-address-hide-save-interruption', async (result) => {
        const input = await loadAddress('address-lifecycle');
        const originalId = await input.getAttribute('id');
        const hiddenDraft = 'Pending hidden address';
        await typeAddress(input, hiddenDraft);
        let state = await waitAddressPending('predictions');
        const oldPrediction = addressPending(state, 'predictions').id;
        const toggle = await find(
            '#screen input[data-field-id="fld_address_driver"]'
        );
        assert(await toggle.isSelected());
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'native-hide-disables-and-skips-address');
        assert(addressControl(state).hidden);
        assert(addressControl(state).disabled);
        assert.equal(await input.isDisplayed(), false);
        assert.equal(await input.isEnabled(), false);
        await assertAddressPopupClosed(result, 'hidden-address');
        assert.equal(state.address.activeFieldId, 'fld_address_tail');
        assert.equal(state.address.abortCounts.predictions, 1);
        assert.equal(saves(state).length, 0);
        await toggle.sendKeys(Key.SPACE, Key.TAB);
        state = await capture(result, 'native-reveal-retains-same-control');
        assert.equal(addressControl(state).id, originalId);
        assert(!addressControl(state).hidden);
        assert(!addressControl(state).disabled);
        assert.equal(await input.isDisplayed(), true);
        assert.equal(await input.isEnabled(), true);
        assert.equal(state.address.activeFieldId, addressFieldId);
        assertAddressQuiet(state, hiddenDraft);
        await assertAddressPopupClosed(result, 'revealed-retained-address');
        await settleAddress('predictions', oldPrediction);
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
        ]);
        state = await capture(
            result,
            'late-prediction-after-reveal-zero-effects'
        );
        assert.equal(addressSettled(state, oldPrediction).aborted, true);
        assertAddressQuiet(state, hiddenDraft);
        await assertAddressPopupClosed(result, 'late-prediction-after-reveal');
        assertAddressReadInputs(state, [hiddenDraft], []);
        assert.equal(saves(state).length, 0);
        const saveDraft = 'Save pending address';
        await typeAddress(input, saveDraft);
        state = await waitAddressPending('predictions');
        await settleAddress(
            'predictions',
            addressPending(state, 'predictions').id
        );
        await addressOptions(result);
        await input.sendKeys(Key.ARROW_DOWN, Key.ENTER);
        state = await waitAddressPending('details');
        const oldDetail = addressPending(state, 'details').id;
        const selected = capped(
            state,
            state.expected.predictions[0].description
        );
        assert.equal(addressControl(state).value, selected);
        assert.equal(saves(state).length, 0);
        await clickText('Save');
        state = await waitAddressPending('save');
        const saveId = addressPending(state, 'save').id;
        state = await capture(
            result,
            'native-save-inert-with-selected-description'
        );
        assert.equal(saves(state).length, 1);
        assertAddressSave(
            saves(state)[0],
            state,
            {
                ...state.expected.initial,
                [addressFieldId]: selected,
            },
            [addressFieldId, 'fld_address_driver']
        );
        assert.equal(state.busy, true);
        assert.equal(state.address.screenInert, true);
        assert.equal(addressControl(state).disabled, true);
        assert.equal(await input.isEnabled(), false);
        await assertAddressPopupClosed(result, 'inert-native-save');
        assert.equal(state.address.abortCounts.details, 1);
        await settleAddress('details', oldDetail);
        state = await capture(
            result,
            'late-detail-during-native-save-zero-effects'
        );
        assert.equal(addressSettled(state, oldDetail).aborted, true);
        assertAddressQuiet(state, selected);
        await assertAddressPopupClosed(result, 'late-detail-during-save');
        assert.equal(state.busy, true);
        assert.equal(saves(state).length, 1);
        await clickText('Release address Save validation');
        await waitReady(
            (value) =>
                addressSettled(value, saveId) &&
                value.status?.includes('The Form was not saved.') &&
                !addressControl(value).disabled,
            'Held normal Save validation re-enables the native address.'
        );
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
            predictionRoute,
            detailRoute,
            'saveForm',
        ]);
        state = await capture(
            result,
            'validation-reenable-retains-selected-draft'
        );
        assertAddressQuiet(state, selected);
        await assertAddressPopupClosed(result, 'validation-reenabled-address');
        assert.equal(state.address.screenInert, false);
        assert.equal(await input.isEnabled(), true);
        assert.equal(saves(state).length, 1);
        assertAddressReadInputs(
            state,
            [hiddenDraft, saveDraft],
            ['place_address_one']
        );
        assertCalls(state, [
            'fetchExtensionForEndUser',
            predictionRoute,
            predictionRoute,
            detailRoute,
            'saveForm',
        ]);
        assert.deepEqual(state.pending, []);
        assert.deepEqual(state.address.abortCounts, {
            predictions: 1,
            details: 1,
            save: 0,
        });
    });
    await exercise('starter-address-aba-discard-remount', async (result) => {
        let input = await loadAddress('address-remount');
        const originalId = await input.getAttribute('id');
        const retained = 'Old visitor prediction';
        await typeAddress(input, retained);
        let state = await waitAddressPending('predictions');
        const oldPrediction = addressPending(state, 'predictions').id;
        await nativeChoice('#visitor', 'B');
        state = await capture(result, 'native-visitor-b-retires-address-owner');
        assert.equal(state.address.presenters.length, 0);
        assert.equal(state.address.controls.length, 0);
        assert.equal(state.address.abortCounts.predictions, 1);
        assert.equal(saves(state).length, 0);
        await nativeChoice('#visitor', 'A');
        await waitReady(
            (value) =>
                value.address.presenters.length === 1 &&
                addressControl(value).id !== originalId &&
                !addressControl(value).disabled,
            'Actual A-B-A remount supplies a new enabled address owner.'
        );
        input = await find(addressSelector);
        const remountedId = await input.getAttribute('id');
        state = await capture(
            result,
            'native-aba-remount-retains-draft-no-query'
        );
        assertAddressQuiet(state, retained);
        assertAddressReadInputs(state, [retained], []);
        await settleAddress('predictions', oldPrediction);
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
        ]);
        state = await capture(
            result,
            'held-old-prediction-after-aba-zero-effects'
        );
        assert.equal(addressSettled(state, oldPrediction).aborted, true);
        assertAddressQuiet(state, retained);
        assert.equal(addressControl(state).id, remountedId);
        assert.equal(saves(state).length, 0);
        const discarded = 'Discard detail request';
        await typeAddress(input, discarded);
        state = await waitAddressPending('predictions');
        await settleAddress(
            'predictions',
            addressPending(state, 'predictions').id
        );
        const options = await addressOptions(result);
        await options[0].click();
        state = await waitAddressPending('details');
        const oldDetail = addressPending(state, 'details').id;
        assert.equal(
            addressControl(state).value,
            capped(state, state.expected.predictions[0].description)
        );
        assert.equal(saves(state).length, 0);
        await clickText('Discard draft');
        await waitReady(
            (value) =>
                addressControl(value).id !== remountedId &&
                !addressControl(value).disabled &&
                value.status ===
                    'This Form draft was discarded. No record was saved.',
            'Native Discard replaces the owner and restores loaded native data.'
        );
        input = await find(addressSelector);
        const discardedId = await input.getAttribute('id');
        state = await capture(
            result,
            'native-discard-remount-restores-loaded-data'
        );
        assertAddressQuiet(state, state.expected.initial[addressFieldId]);
        assert.equal(state.address.abortCounts.details, 1);
        await settleAddress('details', oldDetail);
        await observeAddressCalls([
            'fetchExtensionForEndUser',
            predictionRoute,
            predictionRoute,
            detailRoute,
        ]);
        state = await capture(
            result,
            'held-old-detail-after-discard-zero-effects'
        );
        assert.equal(addressSettled(state, oldDetail).aborted, true);
        assert.equal(addressControl(state).id, discardedId);
        assertAddressQuiet(state, state.expected.initial[addressFieldId]);
        assert.equal(saves(state).length, 0);
        assertAddressReadInputs(
            state,
            [retained, discarded],
            ['place_address_one']
        );
        await clickText('Save');
        await waitReady(
            (value) =>
                saves(value).length === 1 &&
                value.status?.includes('The Form was not saved.'),
            'Deliberate restored native Save has no discarded address dirty ID.'
        );
        state = await capture(
            result,
            'complete-restored-native-save-no-dirty-id'
        );
        assertAddressSave(saves(state)[0], state, state.expected.initial, []);
        assertAddressQuiet(state, state.expected.initial[addressFieldId]);
        assertCalls(state, [
            'fetchExtensionForEndUser',
            predictionRoute,
            predictionRoute,
            detailRoute,
            'saveForm',
        ]);
        assert.deepEqual(state.pending, []);
        assert.deepEqual(state.address.abortCounts, {
            predictions: 1,
            details: 1,
            save: 0,
        });
    });
    for (const multiple of [false, true]) {
        await exercise(
            multiple
                ? 'starter-projection-multiple'
                : 'starter-projection-single',
            async (result) => {
                await driver.get(
                    `${origin}/starter/index.html?scenario=projection-${multiple ? 'multiple' : 'single'}`
                );
                await clickText('Connect and load');
                const choiceId = multiple
                    ? 'fld_projection_multiple'
                    : 'fld_projection_single';
                const selectSelector = `#screen select[data-field-id="${choiceId}"]`;
                const projectionChoice = (state) =>
                    state.selects.find((entry) => entry.fieldId === choiceId);
                const selectedProjection = (state) =>
                    projectionChoice(state)
                        .options.filter(
                            (entry) => entry.selected && entry.value !== ''
                        )
                        .map((entry) => entry.value);
                const assertBetaDenied = (state) => {
                    const beta = projectionChoice(state).options.find(
                        (entry) => entry.value === 'Beta'
                    );
                    assert(!beta || beta.disabled);
                    assert(
                        !projectionChoice(state).options.some(
                            (entry) => entry.value === 'Gamma'
                        ),
                        'Static allowlist must still exclude Gamma.'
                    );
                };
                const driverSelector =
                    '#screen input[data-field-id="fld_projection_driver"]';
                const showSelector =
                    '#screen input[data-field-id="fld_projection_show"]';
                const witnessSelector =
                    '#screen input[data-field-id="fld_projection_witness"]';
                const assertCompleteSave = (
                    call,
                    state,
                    show,
                    selectedValue
                ) => {
                    assert.equal(call.method, 'POST');
                    assert.equal(
                        call.input.extensionAccessToken,
                        'FAKE_SYNTHETIC_PROJECTION_TOKEN'
                    );
                    assert.deepEqual(call.input.formRecord, {
                        type: 'edit',
                        tableId: state.expected.tableId,
                        recordId: state.expected.recordId,
                        data: {
                            ...state.expected.initial,
                            fld_projection_show: show,
                            fld_projection_driver: 'allowed edited',
                            [choiceId]: selectedValue,
                        },
                    });
                    assert.deepEqual(
                        [...call.input.formFieldIdsWithUnsavedChanges].sort(),
                        [
                            'fld_projection_show',
                            'fld_projection_driver',
                            choiceId,
                        ].sort()
                    );
                    assert.deepEqual(call.input.context, {
                        type: 'direct-url',
                    });
                    assert.deepEqual(
                        call.input
                            .conditionalLinkedRecordFieldIdsToFilteringValues,
                        {}
                    );
                };
                await waitReady(
                    (state) =>
                        projectionChoice(state) != null &&
                        state.status === 'Loaded form loaded.',
                    'Actual flat conditional projection Form load.'
                );
                let state = await capture(
                    result,
                    'populated-driver-denies-beta'
                );
                assertBetaDenied(state);
                assert.equal(saves(state).length, 0);
                await assertNativeVisibility(
                    ['fld_projection_driver', 'fld_projection_witness'],
                    true
                );
                const witness = await find(witnessSelector);
                assert.equal(await witness.isEnabled(), false);
                assert.equal(
                    await witness.getAttribute('value'),
                    'Retained readonly text'
                );
                const text = await find(driverSelector);
                const originalTextId = await text.getId();
                await replaceInput(text, 'allowed edited', 'text');
                const show = await find(showSelector);
                assert.equal(await show.isSelected(), true);
                await show.sendKeys(Key.SPACE, Key.TAB);
                await waitReady(
                    (value) =>
                        visibilityControl(value, 'fld_projection_driver')
                            .hidden &&
                        projectionChoice(value).options.some(
                            (entry) => entry.value === 'Beta' && !entry.disabled
                        ),
                    'Hidden scalar driver removes only its evaluation-copy ID.'
                );
                state = await capture(
                    result,
                    'hidden-driver-enables-beta-full-record-witness'
                );
                await assertNativeVisibility(['fld_projection_driver'], false);
                await assertNativeVisibility(['fld_projection_witness'], true);
                assert.equal(
                    await text.getAttribute('value'),
                    'allowed edited'
                );
                assert.equal(
                    await witness.getAttribute('value'),
                    'Retained readonly text'
                );
                assert.equal(await witness.isEnabled(), false);
                assert.equal(
                    projectionChoice(state).options.find(
                        (entry) => entry.value === 'Beta'
                    ).label,
                    'Projected Beta'
                );
                assert.equal(
                    await (
                        await find(
                            `#screen [data-choice-availability-field-id="${choiceId}"]`
                        )
                    ).getAttribute('data-choice-availability'),
                    'ready'
                );
                assert.equal(saves(state).length, 0);
                const select = await find(selectSelector);
                assert.equal(
                    await select.getAttribute('multiple'),
                    multiple ? 'true' : null
                );
                await select.sendKeys(Key.END, Key.TAB);
                state = await capture(
                    result,
                    'native-projected-beta-selection'
                );
                assert.deepEqual(selectedProjection(state), ['Beta']);
                assert.equal(saves(state).length, 0);
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 1 &&
                        value.status?.includes('The Form was not saved.'),
                    'Deliberate complete native Save preserves hidden scalar driver.'
                );
                state = await capture(result, 'complete-hidden-native-save');
                assertCompleteSave(
                    saves(state)[0],
                    state,
                    false,
                    multiple ? ['Beta'] : 'Beta'
                );
                await assertNativeVisibility(['fld_projection_driver'], false);
                await show.sendKeys(Key.SPACE, Key.TAB);
                await waitReady(
                    (value) =>
                        !visibilityControl(value, 'fld_projection_driver')
                            .hidden,
                    'Reveal restores the populated scalar driver without rewriting it.'
                );
                state = await capture(
                    result,
                    'revealed-driver-retains-unavailable-beta'
                );
                await assertNativeVisibility(
                    ['fld_projection_driver', 'fld_projection_witness'],
                    true
                );
                assert.equal(
                    await text.getAttribute('value'),
                    'allowed edited'
                );
                assert.deepEqual(selectedProjection(state), ['Beta']);
                assert.equal(
                    projectionChoice(state).options.find(
                        (entry) => entry.value === 'Beta'
                    ).label,
                    'Projected Beta'
                );
                assert.equal(saves(state).length, 1);
                if (multiple) {
                    const retained = await (
                        await find(selectSelector)
                    ).findElement(By.css('option[value="Beta"]'));
                    assert(await retained.isEnabled());
                    await driver
                        .actions()
                        .keyDown(Key.CONTROL)
                        .click(retained)
                        .keyUp(Key.CONTROL)
                        .perform();
                    await (await find(selectSelector)).sendKeys(Key.TAB);
                } else
                    await (
                        await find(selectSelector)
                    ).sendKeys(Key.HOME, Key.TAB);
                state = await capture(
                    result,
                    'native-removal-denies-readdition'
                );
                assert.deepEqual(selectedProjection(state), []);
                assertBetaDenied(state);
                assert.equal(saves(state).length, 1);
                await clickText('Save');
                await waitReady(
                    (value) =>
                        saves(value).length === 2 &&
                        value.status?.includes('The Form was not saved.'),
                    'Deliberate complete native cleared-selection Save.'
                );
                state = await capture(result, 'complete-cleared-native-save');
                assertCompleteSave(
                    saves(state)[1],
                    state,
                    true,
                    multiple ? [] : null
                );
                await nativeChoice('#visitor', 'B');
                state = await capture(
                    result,
                    'native-visitor-b-retires-projection-controls'
                );
                assert.equal(state.visibility.controls.length, 0);
                assert.equal(projectionChoice(state), undefined);
                assert.equal(saves(state).length, 2);
                await nativeChoice('#visitor', 'A');
                await waitReady(
                    (value) => projectionChoice(value) != null && !value.busy,
                    'A-to-B-to-A restores the accepted draft with a fresh owner.'
                );
                state = await capture(
                    result,
                    'native-aba-fresh-controls-retained-draft'
                );
                assert.notEqual(
                    await (await find(driverSelector)).getId(),
                    originalTextId
                );
                assert.equal(
                    await (await find(driverSelector)).getAttribute('value'),
                    'allowed edited'
                );
                assert.equal(
                    await (await find(showSelector)).isSelected(),
                    true
                );
                assert.deepEqual(selectedProjection(state), []);
                assertBetaDenied(state);
                assertCalls(state, [
                    'fetchExtensionForEndUser',
                    'saveForm',
                    'saveForm',
                ]);
            }
        );
    }
    const reviewSelector = 'dialog[data-form-review][open]';
    const reviewDialog = () => find(reviewSelector);
    const waitReview = async () => {
        const state = await waitSnapshot(
            (value) =>
                value.review?.dialogs.length === 1 &&
                value.review.dialogs[0].open &&
                value.review.fieldsInert,
            'Actual semantic review modal opens before any Save.'
        );
        const dialog = await reviewDialog();
        assert(await dialog.isDisplayed());
        assert.equal(await dialog.getDomAttribute('role'), 'dialog');
        assert.equal(await dialog.getDomAttribute('aria-modal'), 'true');
        const buttons = await dialog.findElements(By.css('button'));
        const edit = buttons[0];
        assert.equal((await edit.getText()).trim(), 'Edit');
        assert.equal(
            await (await driver.switchTo().activeElement()).getId(),
            await edit.getId()
        );
        assert.equal((await dialog.findElements(By.css('img,b,a'))).length, 0);
        assert.equal(state.review.dialogs[0].nestedMarkup, 0);
        for (const label of await dialog.findElements(By.css('dt'))) {
            const id = await label.getDomAttribute('id');
            const value = await label.findElement(
                By.xpath('following-sibling::dd[1]')
            );
            assert.equal(await value.getDomAttribute('aria-labelledby'), id);
        }
        return state;
    };
    const openReview = async () => {
        const saveButtons = await driver.findElements(By.css('#screen button'));
        const matches = [];
        for (const button of saveButtons)
            if ((await button.getText()).trim() === 'Save')
                matches.push(button);
        assert.equal(matches.length, 1);
        assert(await matches[0].isEnabled());
        // Focus the real submit button and activate it with the real keyboard.
        await matches[0].sendKeys(Key.ENTER);
        return waitReview();
    };
    const waitReviewClosed = () =>
        waitSnapshot(
            (state) =>
                state.review.dialogs.length === 0 &&
                !state.review.fieldsInert &&
                !state.busy,
            'Edit/Escape restores the current Form without a Save.'
        );
    const reviewControl = (state, id) => {
        const control = state.review.controls.find(
            (entry) => entry.fieldId === id
        );
        assert(control, `Missing review control ${id}.`);
        return control;
    };
    const loadReview = async (scenario) => {
        await driver.get(`${origin}/starter/index.html?scenario=${scenario}`);
        await clickText('Connect and load');
        return waitReady(
            (state) =>
                state.review?.controls.length === 8 &&
                state.status === 'Loaded form loaded.',
            'Actual archive-copied prepared review Form load.'
        );
    };
    const assertReviewSave = (call, state, data, dirty) => {
        assert.equal(call.method, 'POST');
        assert.equal(
            call.input.extensionAccessToken,
            'FAKE_SYNTHETIC_REVIEW_TOKEN'
        );
        assert.deepEqual(call.input.formRecord, {
            type: 'edit',
            tableId: state.expected.tableId,
            recordId: state.expected.recordId,
            data,
        });
        assert.deepEqual(
            [...call.input.formFieldIdsWithUnsavedChanges].sort(),
            [...dirty].sort()
        );
        assert.deepEqual(call.input.context, { type: 'direct-url' });
        assert.deepEqual(
            call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
            {}
        );
        assert.equal(call.input.isComputeMode, false);
    };
    await exercise(
        'starter-review-edit-escape-current-confirm',
        async (result) => {
            let state = await loadReview('review-answers');
            assert.equal(saves(state).length, 0);
            const secret = await find(
                '#screen input[data-field-id="fld_review_title"]'
            );
            await replaceInput(secret, 'SecondExactReviewSecret', 'password');
            const conditional = await find(
                '#screen input[data-field-id="fld_review_conditional"]'
            );
            await replaceInput(
                conditional,
                'Edited conditional answer',
                'text'
            );
            const show = await find(
                '#screen input[data-field-id="fld_review_show"]'
            );
            await show.sendKeys(Key.SPACE, Key.TAB);
            await assertNativeVisibility(['fld_review_conditional'], false);
            state = await openReview();
            const dialog = await reviewDialog();
            state = await capture(
                result,
                'semantic-ordered-mask-plain-text-review',
                dialog
            );
            assert.deepEqual(state.review.dialogs[0].rows, [
                {
                    fieldId: 'fld_review_title',
                    title: '<b>Semantic secret</b>',
                    hideTitle: true,
                    labelId: 'confirmation-review-label-0',
                    value: '••••••••',
                    labelledBy: 'confirmation-review-label-0',
                },
                {
                    fieldId: 'fld_review_readonly',
                    title: 'Plain readonly answer',
                    hideTitle: false,
                    labelId: 'confirmation-review-label-1',
                    value: state.expected.initial.fld_review_readonly,
                    labelledBy: 'confirmation-review-label-1',
                },
                {
                    fieldId: 'fld_review_url',
                    title: 'Plain URL answer',
                    hideTitle: false,
                    labelId: 'confirmation-review-label-2',
                    value: state.expected.initial.fld_review_url,
                    labelledBy: 'confirmation-review-label-2',
                },
                {
                    fieldId: 'fld_review_number',
                    title: 'Zero count',
                    hideTitle: false,
                    labelId: 'confirmation-review-label-3',
                    value: '0',
                    labelledBy: 'confirmation-review-label-3',
                },
            ]);
            assert.deepEqual(
                await Promise.all(
                    (await dialog.findElements(By.css('dd'))).map((node) =>
                        node.getText()
                    )
                ),
                [
                    '••••••••',
                    state.expected.initial.fld_review_readonly,
                    state.expected.initial.fld_review_url,
                    '0',
                ]
            );
            assert(
                !(await dialog.getText()).includes('SecondExactReviewSecret')
            );
            const hiddenLabel = await dialog.findElement(
                By.css('dt[data-review-title-hidden="true"]')
            );
            assert.equal(await hiddenLabel.getCssValue('position'), 'absolute');
            assert.equal(await hiddenLabel.getCssValue('width'), '1px');
            assert.equal(await hiddenLabel.getCssValue('height'), '1px');
            assert.equal(await hiddenLabel.getCssValue('overflow'), 'hidden');
            assert.equal(
                await hiddenLabel.getCssValue('clip-path'),
                'inset(100%)'
            );
            assert.equal(saves(state).length, 0);
            await clickText('Edit', dialog);
            await waitReviewClosed();
            state = await capture(
                result,
                'native-edit-zero-save-retains-accepted-draft'
            );
            assert.equal(saves(state).length, 0);
            assert.equal(
                reviewControl(state, 'fld_review_title').value,
                'SecondExactReviewSecret'
            );
            assert.equal(
                reviewControl(state, 'fld_review_conditional').value,
                'Edited conditional answer'
            );
            assert.equal(
                (
                    await (await driver.switchTo().activeElement()).getText()
                ).trim(),
                'Save'
            );
            await openReview();
            await (
                await driver.switchTo().activeElement()
            ).sendKeys(Key.ESCAPE);
            await waitReviewClosed();
            state = await capture(
                result,
                'native-escape-zero-save-restores-submit-focus'
            );
            assert.equal(saves(state).length, 0);
            assert.equal(
                (
                    await (await driver.switchTo().activeElement()).getText()
                ).trim(),
                'Save'
            );
            await openReview();
            await (await driver.switchTo().activeElement()).sendKeys(Key.ENTER);
            await waitReviewClosed();
            state = await capture(
                result,
                'initial-edit-enter-cancels-zero-save'
            );
            assert.equal(saves(state).length, 0);
            await openReview();
            await clickText('Confirm', await reviewDialog());
            await waitReady(
                (value) =>
                    saves(value).length === 1 &&
                    value.status?.includes('The Form was not saved.'),
                'One explicit current Confirm dispatches the captured complete native draft.'
            );
            state = await capture(
                result,
                'confirmed-full-hidden-native-save-once'
            );
            assertReviewSave(
                saves(state)[0],
                state,
                {
                    ...state.expected.initial,
                    fld_review_title: 'SecondExactReviewSecret',
                    fld_review_conditional: 'Edited conditional answer',
                    fld_review_show: false,
                },
                [
                    'fld_review_title',
                    'fld_review_conditional',
                    'fld_review_show',
                ]
            );
            assert.equal(state.review.dialogs.length, 0);
            assert.equal(
                reviewControl(state, 'fld_review_conditional').hidden,
                true
            );
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
        }
    );
    await exercise(
        'starter-review-address-retirement-before-capture',
        async (result) => {
            const input = await loadAddress('review-address');
            const manual = 'Review pending prediction';
            await typeAddress(input, manual);
            let state = await waitAddressPending('predictions');
            const oldPrediction = addressPending(state, 'predictions').id;
            await openReview();
            state = await capture(
                result,
                'review-retires-held-prediction-before-capture',
                await reviewDialog()
            );
            assert.equal(state.address.abortCounts.predictions, 1);
            assert.equal(addressControl(state).disabled, true);
            assert.equal(
                state.review.dialogs[0].rows.find(
                    (row) => row.fieldId === addressFieldId
                ).value,
                capped(state, manual)
            );
            assert.equal(saves(state).length, 0);
            await clickText('Edit', await reviewDialog());
            await waitReviewClosed();
            await settleAddress('predictions', oldPrediction);
            await observeAddressCalls([
                'fetchExtensionForEndUser',
                predictionRoute,
            ]);
            state = await capture(
                result,
                'late-prediction-after-edit-zero-options-or-repeat-read'
            );
            assert.equal(addressSettled(state, oldPrediction).aborted, true);
            assertAddressQuiet(state, capped(state, manual));
            assert.equal(saves(state).length, 0);
            const fresh = 'Review selected details';
            await typeAddress(input, fresh);
            state = await waitAddressPending('predictions');
            await settleAddress(
                'predictions',
                addressPending(state, 'predictions').id
            );
            const options = await addressOptions(result);
            await options[0].click();
            state = await waitAddressPending('details');
            const oldDetail = addressPending(state, 'details').id;
            const selected = capped(
                state,
                state.expected.predictions[0].description
            );
            await openReview();
            state = await capture(
                result,
                'review-retires-held-details-captures-selected-description',
                await reviewDialog()
            );
            assert.equal(state.address.abortCounts.details, 1);
            assert.equal(
                state.review.dialogs[0].rows.find(
                    (row) => row.fieldId === addressFieldId
                ).value,
                selected
            );
            assert.equal(saves(state).length, 0);
            await clickText('Edit', await reviewDialog());
            await waitReviewClosed();
            await settleAddress('details', oldDetail);
            await observeAddressCalls([
                'fetchExtensionForEndUser',
                predictionRoute,
                predictionRoute,
                detailRoute,
            ]);
            state = await capture(
                result,
                'late-details-after-edit-preserve-selected-native-draft'
            );
            assert.equal(addressSettled(state, oldDetail).aborted, true);
            assertAddressQuiet(state, selected);
            assert.equal(saves(state).length, 0);
            await openReview();
            await clickText('Confirm', await reviewDialog());
            state = await waitAddressPending('save');
            assertAddressSave(
                saves(state)[0],
                state,
                { ...state.expected.initial, [addressFieldId]: selected },
                [addressFieldId]
            );
            const saveId = addressPending(state, 'save').id;
            await clickText('Release address Save validation');
            await waitReady(
                (value) =>
                    addressSettled(value, saveId) &&
                    !value.busy &&
                    value.status?.includes('The Form was not saved.'),
                'Explicit review Confirm retains selected native address after validation.'
            );
            state = await capture(
                result,
                'fresh-current-review-confirm-selected-description-save'
            );
            assertAddressQuiet(state, selected);
            assert.equal(state.review.dialogs.length, 0);
            assert.equal(saves(state).length, 1);
            assertCalls(state, [
                'fetchExtensionForEndUser',
                predictionRoute,
                predictionRoute,
                detailRoute,
                'saveForm',
            ]);
            assert.deepEqual(state.pending, []);
        }
    );
    await exercise(
        'starter-review-required-validation-draft-preservation',
        async (result) => {
            let state = await loadReview('review-validation');
            const title = await find(
                '#screen input[data-field-id="fld_review_title"]'
            );
            assert.equal(await title.getAttribute('value'), '');
            await openReview();
            state = await capture(
                result,
                'required-empty-answer-review-opens-before-validation',
                await reviewDialog()
            );
            assert(
                !state.review.dialogs[0].rows.some(
                    (row) => row.fieldId === 'fld_review_title'
                )
            );
            assert.equal(saves(state).length, 0);
            await clickText('Confirm', await reviewDialog());
            await waitReady(
                (value) =>
                    saves(value).length === 1 &&
                    value.review.errors.some((text) =>
                        text.includes(value.expected.validationMessage)
                    ),
                'Synthetic returned required validation is presented without dropping the draft.'
            );
            state = await capture(
                result,
                'returned-required-error-full-draft-retained'
            );
            assertReviewSave(
                saves(state)[0],
                state,
                state.expected.initial,
                []
            );
            assert.equal(await title.getAttribute('value'), '');
            assert(
                (await (await find('#screen .error-list')).getText()).includes(
                    state.expected.validationMessage
                )
            );
            await replaceInput(title, 'Repaired required answer', 'text');
            await openReview();
            state = await capture(
                result,
                'repaired-answer-fresh-review-zero-extra-save',
                await reviewDialog()
            );
            assert.equal(
                state.review.dialogs[0].rows.find(
                    (row) => row.fieldId === 'fld_review_title'
                ).value,
                'Repaired required answer'
            );
            assert.equal(saves(state).length, 1);
            await clickText('Edit', await reviewDialog());
            await waitReviewClosed();
            state = await capture(
                result,
                'native-edit-preserves-repair-and-validation-no-replay'
            );
            assert.equal(
                await title.getAttribute('value'),
                'Repaired required answer'
            );
            assert.equal(saves(state).length, 1);
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
        }
    );
    await exercise(
        'starter-review-cancelled-unknown-save-no-replay',
        async (result) => {
            await loadReview('review-unknown');
            await openReview();
            await clickText('Confirm', await reviewDialog());
            let state = await waitSnapshot(
                (value) =>
                    saves(value).length === 1 &&
                    value.pending.length === 1 &&
                    value.busy,
                'One confirmed Save is held by the synthetic transport.'
            );
            state = await capture(
                result,
                'confirmed-single-held-save-complete-native-data'
            );
            assertReviewSave(
                saves(state)[0],
                state,
                state.expected.initial,
                []
            );
            assert.equal(state.review.dialogs.length, 0);
            const saveButtons = await driver.findElements(
                By.css('#screen button')
            );
            const saveMatches = [];
            for (const button of saveButtons)
                if ((await button.getText()).trim() === 'Save')
                    saveMatches.push(button);
            assert.equal(saveMatches.length, 1);
            assert.equal(await saveMatches[0].isEnabled(), false);
            await clickText('Cancel request');
            await waitSnapshot(
                (value) => !value.busy && value.review.abortCounts.save === 1,
                'Native Cancel retires the confirmed Save request.'
            );
            state = await capture(
                result,
                'native-cancel-uncertainty-remains-blocked'
            );
            assert.equal(saves(state).length, 1);
            assert.equal(state.review.dialogs.length, 0);
            assert.equal(await saveMatches[0].isEnabled(), false);
            await clickText('Release held review Save');
            await waitSnapshot(
                (value) =>
                    value.pending.length === 0 &&
                    value.events.some(
                        (event) =>
                            event.type === 'review-save-settled' &&
                            event.aborted
                    ),
                'Late cancelled validation arrives without reopening review.'
            );
            // Repeat a physical Enter from the actual retained Form input, rather
            // than activating the transport-release button that currently holds
            // focus. The disabled submit and uncertain scope must not dispatch.
            await (
                await find('#screen input[data-field-id="fld_review_title"]')
            ).sendKeys(Key.ENTER, Key.ENTER);
            const until = Date.now() + 500;
            await driver.wait(
                async () => {
                    const value = await snapshot();
                    assert.equal(saves(value).length, 1);
                    assert.equal(value.review.dialogs.length, 0);
                    return Date.now() >= until;
                },
                2000,
                'No automatic replay after native cancelled uncertain Save.',
                100
            );
            state = await capture(
                result,
                'late-result-and-repeated-enter-zero-replay'
            );
            assert.equal(await saveMatches[0].isEnabled(), false);
            assert.equal(
                reviewControl(state, 'fld_review_title').value,
                state.expected.initial.fld_review_title
            );
            assert.deepEqual(
                state.events.filter(
                    (event) => event.type === 'review-save-settled'
                ),
                [
                    {
                        type: 'review-save-settled',
                        id: 'review-save-1',
                        aborted: true,
                    },
                ]
            );
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
        }
    );
    const emptyControl = (state, name) =>
        visibilityControl(state, `fld_empty_${name}`);
    const loadEmpty = async (scenario) => {
        await driver.get(`${origin}/starter/index.html?scenario=${scenario}`);
        await clickText('Connect and load');
        return waitReady(
            (value) =>
                value.visibility?.controls.length === 14 &&
                value.status === 'Loaded form loaded.',
            'Actual twelve-family empty-hiding Form load.'
        );
    };
    const assertEmptySave = (state, expectedData, dirtyIds) => {
        assert.equal(saves(state).length, 1);
        const call = saves(state)[0];
        assert.equal(call.method, 'POST');
        assert.equal(
            call.input.extensionAccessToken,
            'FAKE_SYNTHETIC_HIDE_EMPTY_TOKEN'
        );
        assert.deepEqual(call.input.formRecord, {
            type: 'edit',
            tableId: state.expected.tableId,
            recordId: state.expected.recordId,
            data: expectedData,
        });
        assert.deepEqual(call.input.formFieldIdsWithUnsavedChanges, dirtyIds);
        assert.deepEqual(call.input.context, { type: 'direct-url' });
        assert.deepEqual(
            call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
            {}
        );
        assert.equal(call.input.isComputeMode, false);
    };
    await exercise(
        'starter-edit-empty-hidden-required-native-save',
        async (result) => {
            await loadEmpty('hide-empty-edit');
            let state = await capture(
                result,
                'canonical-empty-and-populated-native-twins'
            );
            const hidden = [
                'email',
                'url',
                'multiline',
                'phone',
                'rich',
                'rating',
                'checkbox',
                'barcode',
            ];
            const visible = [
                'title',
                'number',
                'currency',
                'percent',
                'locked',
                'tail',
            ];
            for (const name of hidden) assert(emptyControl(state, name).hidden);
            for (const name of visible)
                assert(!emptyControl(state, name).hidden);
            await assertNativeVisibility(
                hidden.map((name) => `fld_empty_${name}`),
                false
            );
            await assertNativeVisibility(
                visible.map((name) => `fld_empty_${name}`),
                true
            );
            assert(emptyControl(state, 'email').disabled);
            assert(emptyControl(state, 'locked').disabled);
            assert.equal(
                await (
                    await find('#screen [data-field-id="fld_empty_locked"]')
                ).isEnabled(),
                false
            );
            assert(visibilityAlert(state).hidden);
            await assertNativeVisibilityAlert(false);
            assert.equal(saves(state).length, 0);
            const title = await find(
                '#screen input[data-field-id="fld_empty_title"]'
            );
            const initialTitleId = await title.getId();
            // One accepted whitespace input hides this same control. Do not clear it
            // first or send a second key command to an already hidden element.
            await title.sendKeys(Key.chord(Key.CONTROL, 'a'), ' ');
            await waitReady(
                (value) =>
                    emptyControl(value, 'title').hidden &&
                    emptyControl(value, 'title').value === ' ',
                'Native accepted whitespace self-hides the target.'
            );
            await replaceInput(
                await find('#screen input[data-field-id="fld_empty_tail"]'),
                'Accepted empty-hiding sibling',
                'text'
            );
            state = await capture(
                result,
                'accepted-whitespace-hidden-with-visible-sibling'
            );
            assert.equal(await title.getAttribute('value'), ' ');
            assert.equal(await title.isDisplayed(), false);
            assert.equal(
                emptyControl(state, 'tail').value,
                'Accepted empty-hiding sibling'
            );
            assert.equal(saves(state).length, 0);
            await clickText('Save');
            await waitReady(
                (value) =>
                    saves(value).length === 1 &&
                    value.status?.includes('validation errors') &&
                    value.visibility.errors.some(
                        (text) =>
                            text ===
                            `Hidden required answer: ${value.expected.validationMessage}`
                    ),
                'Synthetic returned hidden-required error is visible after one complete native Save.'
            );
            state = await capture(
                result,
                'returned-hidden-required-error-full-native-save'
            );
            assertEmptySave(
                state,
                {
                    ...state.expected.initial,
                    fld_empty_title: ' ',
                    fld_empty_tail: 'Accepted empty-hiding sibling',
                },
                ['fld_empty_title', 'fld_empty_number', 'fld_empty_tail']
            );
            assert(
                (await (await find('#screen .error-list')).getText()).includes(
                    `Hidden required answer: ${state.expected.validationMessage}`
                )
            );
            assert.equal(emptyControl(state, 'title').value, ' ');
            assert(emptyControl(state, 'title').hidden);
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
            await nativeChoice('#visitor', 'B');
            await nativeChoice('#visitor', 'A');
            await waitReady(
                (value) =>
                    value.visibility?.controls.length === 14 &&
                    emptyControl(value, 'title').hidden,
                'Native Visitor round trip remounts the accepted hidden draft.'
            );
            state = await capture(
                result,
                'visitor-aba-retains-hidden-answer-without-replay'
            );
            assert.notEqual(
                await (
                    await find('#screen input[data-field-id="fld_empty_title"]')
                ).getId(),
                initialTitleId
            );
            assert.equal(emptyControl(state, 'title').value, ' ');
            assert.equal(
                emptyControl(state, 'tail').value,
                'Accepted empty-hiding sibling'
            );
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
            await clickText('Discard draft');
            await waitReady(
                (value) =>
                    value.status ===
                        'This Form draft was discarded. No record was saved.' &&
                    !emptyControl(value, 'title').hidden,
                'Native Discard restores the loaded initial values.'
            );
            state = await capture(
                result,
                'discard-restores-initial-controls-no-save'
            );
            assert.equal(
                emptyControl(state, 'title').value,
                state.expected.initial.fld_empty_title
            );
            assert.equal(
                emptyControl(state, 'tail').value,
                state.expected.initial.fld_empty_tail
            );
            await assertNativeVisibility(
                ['fld_empty_title', 'fld_empty_tail'],
                true
            );
            assertCalls(state, ['fetchExtensionForEndUser', 'saveForm']);
        }
    );
    await exercise(
        'starter-edit-empty-section-blocked-native-recovery',
        async (result) => {
            await loadEmpty('hide-empty-unavailable');
            let state = await capture(
                result,
                'retained-disabled-section-explicit-unavailable'
            );
            for (const id of state.expected.controlFieldIds.slice(0, 12))
                assert(visibilityControl(state, id).hidden);
            await assertNativeVisibility(
                state.expected.controlFieldIds.slice(0, 12),
                false
            );
            await assertNativeVisibility(
                ['fld_empty_locked', 'fld_empty_tail'],
                true
            );
            assert(!visibilityAlert(state).hidden);
            await assertNativeVisibilityAlert(true);
            assert.equal(saves(state).length, 0);
            const oldTailId = await (
                await find('#screen input[data-field-id="fld_empty_tail"]')
            ).getId();
            await replaceInput(
                await find('#screen input[data-field-id="fld_empty_tail"]'),
                'Accepted blocked sibling',
                'text'
            );
            await clickText('Save');
            await waitReady(
                (value) =>
                    value.status ===
                        'Review the unavailable fields before saving this Form.' &&
                    saves(value).length === 0,
                'Blocked empty hiding prevents native Save dispatch.'
            );
            state = await capture(
                result,
                'blocked-native-save-retains-adjacent-edit'
            );
            assert.equal(
                emptyControl(state, 'tail').value,
                'Accepted blocked sibling'
            );
            assert.equal(emptyControl(state, 'title').value, '');
            assertCalls(state, ['fetchExtensionForEndUser']);
            await nativeChoice('#visitor', 'B');
            await nativeChoice('#visitor', 'A');
            await waitReady(
                (value) =>
                    value.visibility?.controls.length === 14 &&
                    emptyControl(value, 'title').hidden,
                'Blocked native draft remount remains unavailable without replay.'
            );
            state = await capture(
                result,
                'blocked-visitor-aba-keeps-native-draft-zero-save'
            );
            assert.notEqual(
                await (
                    await find('#screen input[data-field-id="fld_empty_tail"]')
                ).getId(),
                oldTailId
            );
            assert.equal(
                emptyControl(state, 'tail').value,
                'Accepted blocked sibling'
            );
            assert.equal(emptyControl(state, 'title').value, '');
            assert(!visibilityAlert(state).hidden);
            assertCalls(state, ['fetchExtensionForEndUser']);
            await (await find('#reload')).click();
            await waitReady(
                (value) =>
                    value.events.filter(
                        (event) => event.type === 'hide-empty-root-response'
                    ).length === 2 &&
                    !emptyControl(value, 'title').hidden &&
                    value.status === 'Loaded form loaded.',
                'Explicit native Reload supplies no-section hide-false replacement.'
            );
            state = await capture(
                result,
                'supported-explicit-reload-reveals-empty-controls'
            );
            await assertNativeVisibility(state.expected.controlFieldIds, true);
            assert(visibilityAlert(state).hidden);
            await assertNativeVisibilityAlert(false);
            assert.equal(
                emptyControl(state, 'tail').value,
                state.expected.initial.fld_empty_tail
            );
            assert.deepEqual(
                state.events
                    .filter(
                        (event) => event.type === 'hide-empty-root-response'
                    )
                    .map((event) => event.blocked),
                [true, false]
            );
            assertCalls(state, [
                'fetchExtensionForEndUser',
                'fetchExtensionForEndUser',
            ]);
            await replaceInput(
                await find('#screen input[data-field-id="fld_empty_tail"]'),
                'Accepted recovered sibling',
                'text'
            );
            await clickText('Save');
            await waitReady(
                (value) =>
                    saves(value).length === 1 &&
                    value.status?.includes('validation errors'),
                'Only fresh explicit native Save dispatches after supported recovery.'
            );
            state = await capture(
                result,
                'recovered-explicit-save-complete-native-envelope'
            );
            assertEmptySave(
                state,
                {
                    ...state.expected.initial,
                    fld_empty_tail: 'Accepted recovered sibling',
                },
                ['fld_empty_title', 'fld_empty_number', 'fld_empty_tail']
            );
            assertCalls(state, [
                'fetchExtensionForEndUser',
                'fetchExtensionForEndUser',
                'saveForm',
            ]);
        }
    );
    assert.equal(receipt.cases.length, 32);
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
    // This is an actual path-absence check after quit/service/process cleanup
    // and owned work removal, not a finally/quit inference.
    receipt.cleanup.ownedProfileDirectory = {
        path: profile,
        existsAfterOwnedWorkRemoval: existsSync(profile),
    };
    receipt.cleanup.ownedProfileDirectoryRemoved = !existsSync(profile);
    if (!receipt.cleanup.ownedProfileDirectoryRemoved) process.exitCode = 1;
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
