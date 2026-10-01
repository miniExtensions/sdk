import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkPath = 'node_modules/@miniextensions/sdk';

function isWithin(root, path) {
    const difference = relative(root, path);
    return (
        difference === '' ||
        (!isAbsolute(difference) &&
            difference !== '..' &&
            !difference.startsWith(`..${sep}`))
    );
}

function withoutFences(markdown) {
    let fence;
    return markdown
        .split('\n')
        .map((line) => {
            const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
            if (fence) {
                if (marker?.[0] === fence[0] && marker.length >= fence.length) {
                    fence = undefined;
                }
                return '';
            }
            if (marker) {
                fence = marker;
                return '';
            }
            return line;
        })
        .join('\n');
}

// This covers the inline/reference destinations and ATX headings used by the
// shipped guides. It intentionally does not implement a full Markdown parser.
function markdownTargets(markdown) {
    const prose = withoutFences(markdown).replace(/(`+)[\s\S]*?\1/g, '');
    const references = new Map();
    const normalize = (label) =>
        label.trim().replace(/\s+/g, ' ').toLowerCase();
    const text = prose.replace(
        /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]+>|\S+).*$/gm,
        (_, label, target) => {
            references.set(normalize(label), target);
            return '';
        }
    );
    const targets = Array.from(
        text.matchAll(
            /\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*["'])?\s*\)/g
        ),
        (match) => match[1]
    );
    for (const [, label, reference] of text.matchAll(
        /\[([^\]]+)\]\[([^\]]*)\]/g
    )) {
        const name = normalize(reference || label);
        assert(references.has(name), `Undefined Markdown reference: ${name}`);
        targets.push(references.get(name));
    }
    for (const [, label] of text.matchAll(/\[([^\]]+)\](?![\[(])/g)) {
        const target = references.get(normalize(label));
        if (target) targets.push(target);
    }
    return targets.map((target) => target.replace(/^<|>$/g, ''));
}

function markdownAnchors(markdown) {
    const anchors = new Set();
    const counts = new Map();
    for (const [, heading] of withoutFences(markdown).matchAll(
        /^ {0,3}#{1,6}[ \t]+(.+)$/gm
    )) {
        const slug = heading
            .replace(/\s+#+\s*$/, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/<[^>]*>/g, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
            .trim()
            .replace(/\s/g, '-');
        const count = counts.get(slug) ?? 0;
        counts.set(slug, count + 1);
        anchors.add(count ? `${slug}-${count}` : slug);
    }
    return anchors;
}

export async function assertPackedDocLinks(packageRoot, packedPaths) {
    const root = await realpath(packageRoot);
    const shipped = new Set(packedPaths);
    for (const document of shipped) {
        if (!document.endsWith('.md')) continue;
        const sourcePath = resolve(root, document);
        assert(isWithin(root, sourcePath), `Doc escapes package: ${document}`);
        assert(
            isWithin(root, await realpath(sourcePath)),
            `Doc escapes package: ${document}`
        );
        const source = await readFile(sourcePath, 'utf8');
        for (const target of markdownTargets(source)) {
            assert(
                !/^[a-z]:[\\/]/i.test(target),
                `Absolute doc link in ${document}: ${target}`
            );
            if (/^(?!file:)[a-z][a-z\d+.-]*:/i.test(target)) continue;
            if (target.startsWith('//')) continue;
            const [location, rawFragment] = target.split('#', 2);
            const path = decodeURIComponent(location.split('?', 1)[0]);
            assert(
                !path.startsWith('/') &&
                    !path.includes('\\') &&
                    !/^[a-z]:/i.test(path),
                `Absolute doc link in ${document}: ${target}`
            );
            const destination = path
                ? posix.normalize(posix.join(posix.dirname(document), path))
                : document;
            assert(
                shipped.has(destination),
                `Unshipped doc link in ${document}: ${target}`
            );
            const destinationPath = resolve(root, destination);
            assert(
                isWithin(root, await realpath(destinationPath)),
                `Doc link escapes package in ${document}: ${target}`
            );
            assert(
                (await lstat(destinationPath)).isFile(),
                `Doc link is not a file in ${document}: ${target}`
            );
            if (rawFragment) {
                assert(
                    destination.endsWith('.md') &&
                        markdownAnchors(
                            await readFile(destinationPath, 'utf8')
                        ).has(decodeURIComponent(rawFragment)),
                    `Missing doc anchor in ${document}: ${target}`
                );
            }
        }
    }
}

function archiveFromSpec(spec, consumerRoot) {
    assert(
        spec?.startsWith('file:'),
        `SDK must resolve a file archive: ${spec}`
    );
    return spec.startsWith('file://')
        ? fileURLToPath(spec)
        : resolve(consumerRoot, spec.slice(5));
}

async function installedFiles(root, directory = root) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' && entry.isDirectory()) continue;
        const path = join(directory, entry.name);
        assert(!entry.isSymbolicLink(), `Symlink in installed SDK: ${path}`);
        if (entry.isDirectory())
            files.push(...(await installedFiles(root, path)));
        else files.push(relative(root, path).split(sep).join('/'));
    }
    return files;
}

export async function assertInstalledArchive(
    consumerRoot,
    archivePath,
    packedMetadata
) {
    const consumer = await realpath(consumerRoot);
    const archive = await realpath(archivePath);
    const integrity = `sha512-${createHash('sha512')
        .update(await readFile(archive))
        .digest('base64')}`;
    assert.equal(packedMetadata.integrity, integrity, 'Packed archive changed');
    const lock = JSON.parse(
        await readFile(join(consumer, 'package-lock.json'), 'utf8')
    );
    const locked = lock.packages?.[sdkPath];
    assert(
        locked && !locked.link,
        'SDK must be an installed archive, not a link'
    );
    assert.equal(
        await realpath(archiveFromSpec(locked.resolved, consumer)),
        archive,
        'Lockfile resolved a different SDK archive'
    );
    assert.equal(locked.integrity, integrity, 'Lockfile SDK integrity changed');
    const installed = join(consumer, sdkPath);
    assert(
        (await lstat(installed)).isDirectory() &&
            (await realpath(installed)) === installed,
        'Installed SDK must be inside the clean consumer, without symlinks'
    );
    const metadata = JSON.parse(
        await readFile(join(installed, 'package.json'), 'utf8')
    );
    assert.equal(metadata.name, '@miniextensions/sdk');
    assert.equal(metadata.name, packedMetadata.name);
    assert.equal(metadata.version, packedMetadata.version);
    assert.deepEqual(
        (await installedFiles(installed)).sort(),
        packedMetadata.files.map(({ path }) => path).sort(),
        'Installed SDK file list differs from the packed archive'
    );
    for (const { path, size } of packedMetadata.files) {
        assert.equal(
            (await lstat(join(installed, path))).size,
            size,
            `Installed SDK file size differs: ${path}`
        );
    }
}

export async function assertBrowserInputs(metafile, consumerRoot) {
    const consumer = await realpath(consumerRoot);
    const installed = join(consumer, sdkPath);
    let sdkInputs = 0;
    for (const input of Object.keys(metafile.inputs)) {
        const path = await realpath(resolve(consumer, input));
        assert(
            isWithin(consumer, path),
            `Browser build input escapes the clean consumer: ${input}`
        );
        if (isWithin(installed, path)) {
            assert(
                isWithin(join(installed, 'dist'), path),
                `Browser build imported SDK source outside dist: ${input}`
            );
            sdkInputs++;
        }
    }
    assert(
        sdkInputs > 0,
        'Browser build did not bundle the installed SDK dist'
    );
}
