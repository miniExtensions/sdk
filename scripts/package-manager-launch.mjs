import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

const managers = new Set(['npm', 'pnpm', 'corepack']);
const isFile = (file) => statSync(file, { throwIfNoEntry: false })?.isFile();

function environmentValue(environment, name) {
    return Object.entries(environment).find(
        ([key]) => key.toLowerCase() === name.toLowerCase()
    )?.[1];
}

function findWindowsLauncher(command, environment, exists) {
    const extensions = (
        environmentValue(environment, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
    )
        .toLowerCase()
        .split(';')
        .filter((extension) =>
            ['.exe', '.cmd', '.bat', '.com'].includes(extension)
        );
    for (const entry of (environmentValue(environment, 'PATH') ?? '').split(
        ';'
    )) {
        const directory = entry.replace(/^"(.*)"$/, '$1');
        if (!win32.isAbsolute(directory)) continue;
        for (const extension of extensions) {
            const launcher = win32.join(directory, command + extension);
            if (exists(launcher)) return { directory, extension, launcher };
        }
    }
}

export function resolvePackageManagerLaunch(
    command,
    args,
    options,
    {
        platform = process.platform,
        node = process.execPath,
        exists = isFile,
        readShim = (file) => readFileSync(file, 'utf8'),
        execute = execFileSync,
    } = {}
) {
    if (platform !== 'win32' || !managers.has(command)) return [command, args];

    // .cmd files need cmd.exe, which would reinterpret otherwise literal
    // consumer paths and arguments. Use the installed shim's Node entrypoint.
    const environment = options?.env ?? process.env;
    const found = findWindowsLauncher(command, environment, exists);
    if (found?.extension === '.exe' || found?.extension === '.com')
        return [found.launcher, args];

    if (found?.extension === '.cmd') {
        const dir = found.directory;
        const localNode = win32.join(dir, 'node.exe');
        const nodePath = exists(localNode) ? localNode : node;
        const shim = readShim(found.launcher).toLowerCase();
        const installedEntry = (suffix) =>
            ['%~dp0', '%dp0%'].some((variable) =>
                shim.includes(`${variable}\\${suffix}`)
            ) && exists(win32.join(dir, suffix))
                ? win32.join(dir, suffix)
                : undefined;
        const npmCli = installedEntry('node_modules\\npm\\bin\\npm-cli.js');
        const npmPrefix = installedEntry(
            'node_modules\\npm\\bin\\npm-prefix.js'
        );
        if (command === 'npm' && npmCli && npmPrefix) {
            // The bundled Node npm.cmd honors npm's configured global prefix.
            // Preserve its choice of an already-installed npm upgrade.
            const prefix = execute(nodePath, [npmPrefix], {
                cwd: options?.cwd,
                env: environment,
                encoding: 'utf8',
                timeout: options?.timeout ?? 15000,
                stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
            const prefixCli = win32.join(
                prefix,
                'node_modules',
                'npm',
                'bin',
                'npm-cli.js'
            );
            const entry =
                win32.isAbsolute(prefix) && exists(prefixCli)
                    ? prefixCli
                    : npmCli;
            return [nodePath, [entry, ...args]];
        }

        const corepackCli =
            installedEntry(`node_modules\\corepack\\dist\\${command}.js`) ||
            installedEntry(`..\\dist\\${command}.js`);
        const entry = {
            npm: npmCli || corepackCli,
            pnpm:
                installedEntry('node_modules\\pnpm\\bin\\pnpm.cjs') ||
                corepackCli,
            corepack: corepackCli,
        }[command];
        if (entry) return [nodePath, [entry, ...args]];
    }

    throw new Error(
        `Cannot locate the installed Windows ${command} Node entrypoint or executable`
    );
}

export function execPackageFileSync(command, args, options) {
    const [file, argv] = resolvePackageManagerLaunch(command, args, options);
    return execFileSync(file, argv, options);
}

export function spawnPackageFileSync(command, args, options) {
    const [file, argv] = resolvePackageManagerLaunch(command, args, options);
    return spawnSync(file, argv, options);
}
