import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import prettier from 'prettier';

// This is a transport map, not a second definition of any API payload.
const v1 = [
    ['loadExtension', 'fetchExtensionForEndUser', 'FetchExtensionForEndUser'],
    [
        'auth.verifyExtensionPassword',
        'verifyExtensionPassword',
        'VerifyExtensionPassword',
    ],
    [
        'auth.login',
        'loginIntoExtensionUsingLoginPageExtension',
        'LoginIntoExtensionUsingLoginPageExtension',
    ],
    [
        'auth.confirmVerificationCode',
        'confirmVerificationCodeForLogin',
        'ConfirmVerificationCodeForLogin',
    ],
    [
        'auth.signUp',
        'signUpForLoginPageExtension',
        'SignUpForLoginPageExtension',
    ],
    ['forms.save', 'saveForm', 'SaveForm'],
    [
        'portals.listLinkedRecords',
        'fetchRecordsForLinkedTableOnPortal',
        'FetchRecordsForLinkedTableOnPortal',
    ],
    [
        'linkedRecords.listFormOptions',
        'fetchRecordsForLinkedRecordsSelector',
        'FetchRecordsForFormLinkedRecordsSelector',
    ],
    [
        'linkedRecords.listPortalOptions',
        'fetchRecordsForLinkedRecordsSelector',
        'FetchRecordsForPortalLinkedRecordsSelector',
    ],
    [
        'linkedRecords.listConditionalFilterPrimaryValues',
        'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
        'FetchValuesForConditionalLinkedRecordFilterField',
        'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
    ],
];
const trpc = [
    ['forms.deleteCurrentRecord', 'airtable', 'deleteRecord', 'mutation'],
    [
        'forms.addSelectOption',
        'airtable',
        'addNewAirtableOptionForFormField',
        'mutation',
    ],
    ['portals.getUserRecord', 'airtable', 'getUserRecord', 'query'],
    ['portals.updateGridCell', 'airtable', 'updatePortalRecord', 'mutation'],
    ['portals.unlinkRecord', 'airtable', 'unlinkPortalRecord', 'mutation'],
    [
        'portals.setKanbanCategory',
        'airtable',
        'updateRecordKanbanCategory',
        'mutation',
    ],
    [
        'linkedRecords.loadSelectedRecords',
        'publicExtensions',
        'fetchInitialTableIdsToLinkedTableStates',
        'query',
    ],
    [
        'attachments.createUploadUrl',
        'publicExtensions',
        'createPublicUploadLink',
        'mutation',
    ],
    [
        'comments.listForRecord',
        'airtable',
        'getAirtableCommentsForRecord',
        'query',
    ],
    [
        'comments.addToRecord',
        'airtable',
        'addAirtableCommentForRecord',
        'mutation',
    ],
    [
        'addresses.listPredictions',
        'publicExtensions',
        'autoCompleteAddressField',
        'query',
    ],
    [
        'addresses.getFormattedAddress',
        'publicExtensions',
        'getFormattedAddressFromPlaceId',
        'query',
    ],
    [
        'buttons.triggerWebhook',
        'publicExtensions',
        'triggerWebhook',
        'mutation',
    ],
];
const sdkRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);
const argumentsList = process.argv.slice(2);
const option = (name) => argumentsList[argumentsList.indexOf(name) + 1];
const monorepoArgument = argumentsList.includes('--monorepo')
    ? option('--monorepo')
    : null;
if (!monorepoArgument)
    throw new Error('Pass --monorepo <checked-out canonical monorepo>.');
const monorepo = path.resolve(monorepoArgument);
const revision = argumentsList.includes('--revision')
    ? option('--revision')
    : 'fc1f8b05eff9658741cb797428d50ffe384b89e0';
if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Use a full canonical source revision.');
const check = argumentsList.includes('--check');
const verify = argumentsList.includes('--verify');
const diagnose = argumentsList.includes('--diagnose');
if (diagnose && !verify) throw new Error('--diagnose requires --verify.');
const outputDirectory = path.join(sdkRoot, 'src/runtime/contracts');
const generatedFile = path.join(outputDirectory, 'generated.ts');
const provenanceFile = path.join(outputDirectory, 'generated.provenance.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const entryName = path.join(
    monorepo,
    '__sdk_canonical_contract_generation__.ts'
);
const entryLines = [
    "import type { inferRouterInputs, inferRouterOutputs, inferProcedureOutput } from '@trpc/server';",
    "import type { AppTRPCRouter } from './backend-src/trpc/routers';",
    "import type { v1APIRoute } from './types/api/routes';",
    'type RouterInputs = inferRouterInputs<AppTRPCRouter>;',
    'type RouterOutputs = inferRouterOutputs<AppTRPCRouter>;',
];
const operationAliases = [];
for (const [index, [operation, module, type, routeOverride]] of v1.entries()) {
    const route = routeOverride ?? type[0].toLowerCase() + type.slice(1);
    entryLines.push(
        `import type { ${type}Input, ${type}Output } from './types/api/types/${module}';`
    );
    entryLines.push(`export type V1Input${index} = ${type}Input;`);
    entryLines.push(`export type V1Output${index} = ${type}Output;`);
    entryLines.push(`type V1Route${index} = v1APIRoute.${route};`);
    operationAliases.push({
        operation,
        input: `V1Input${index}`,
        output: `V1Output${index}`,
        module: `types/api/types/${module}.ts`,
        route,
        kind: 'POST',
        transport: 'v1',
        routeType: `V1Route${index}`,
    });
}
for (const [index, [operation, group, procedure, kind]] of trpc.entries()) {
    entryLines.push(
        `export type TrpcInput${index} = RouterInputs['${group}']['${procedure}'];`
    );
    entryLines.push(
        `type RawOutput${index} = inferProcedureOutput<AppTRPCRouter['_def']['record']['${group}']['${procedure}']>;`
    );
    // This tRPC release serializes void as never in inferRouterOutputs, while
    // its official client actually resolves undefined. Preserve canonical void
    // only when the raw canonical procedure output establishes that contract.
    entryLines.push(
        `export type TrpcOutput${index} = [RawOutput${index}] extends [void] ? RawOutput${index} : RouterOutputs['${group}']['${procedure}'];`
    );
    entryLines.push(
        `type TrpcKind${index} = AppTRPCRouter['_def']['record']['${group}']['${procedure}']['_def']['type'];`
    );
    operationAliases.push({
        operation,
        input: `TrpcInput${index}`,
        output: `TrpcOutput${index}`,
        route: `${group}.${procedure}`,
        kind,
        transport: 'trpc',
        kindType: `TrpcKind${index}`,
    });
}
entryLines.push(
    "import type { AirtableAttachment, AirtableBarcodeValue, AirtableCollaborator, AirtableField, AirtableFieldSet, AirtableRecord, AirtableValue, SelectFieldChoice } from './types/airtable/types';"
);
entryLines.push(
    'export type CanonicalAirtableAttachment = AirtableAttachment;'
);
entryLines.push(
    'export type CanonicalAirtableBarcodeValue = AirtableBarcodeValue;'
);
entryLines.push(
    'export type CanonicalAirtableCollaborator = AirtableCollaborator;'
);
entryLines.push('export type CanonicalSelectFieldChoice = SelectFieldChoice;');
entryLines.push('export type CanonicalAirtableField = AirtableField;');
entryLines.push('export type CanonicalAirtableFieldSet = AirtableFieldSet;');
entryLines.push('export type CanonicalAirtableRecord = AirtableRecord;');
entryLines.push('export type CanonicalAirtableValue = AirtableValue;');
entryLines.push(
    "import type { LoadExtensionContext, Query, FormErrors, FormLoadedOutput, PortalLoadedOutput, LoginPageOutput, PasswordRequiredOutput, ExtensionScreenAndDataOutput } from './types/api/types/loadExtension';"
);
entryLines.push(
    'export type CanonicalLoadExtensionContext = LoadExtensionContext;'
);
entryLines.push('export type CanonicalQuery = Query;');
entryLines.push('export type CanonicalFormErrors = FormErrors;');
entryLines.push('export type CanonicalFormLoadedOutput = FormLoadedOutput;');
entryLines.push(
    'export type CanonicalPortalLoadedOutput = PortalLoadedOutput;'
);
entryLines.push('export type CanonicalLoginPageOutput = LoginPageOutput;');
entryLines.push(
    'export type CanonicalPasswordRequiredOutput = PasswordRequiredOutput;'
);
entryLines.push(
    "import type { PublicFormDeviceFingerprintInput } from './types/api/types/publicFormDeviceFingerprint';"
);
entryLines.push(
    'export type CanonicalDeviceFingerprint = PublicFormDeviceFingerprintInput;'
);
entryLines.push(
    "import type { PrefillDataForLinkedRecordsForm } from './types/api/prefillDataForLinkedRecordsForm';"
);
entryLines.push(
    'export type CanonicalLinkedRecordPrefill = PrefillDataForLinkedRecordsForm;'
);
entryLines.push(
    "import type { LinkedRecordsSelectorFilter, ConditionalLinkedRecordFilteringValues } from './types/api/types/fetchRecordsForLinkedRecordsSelector';"
);
entryLines.push(
    'export type CanonicalSelectorFilter = LinkedRecordsSelectorFilter;'
);
entryLines.push(
    'export type CanonicalConditionalLinkedRecordFilteringValues = ConditionalLinkedRecordFilteringValues;'
);
entryLines.push("import type { Language } from './types/i18n/strings';");
entryLines.push('export type CanonicalLanguage = Language;');

if (verify) {
    const generatedModule = path
        .relative(monorepo, generatedFile)
        .split(path.sep)
        .join('/')
        .replace(/\.ts$/, '');
    entryLines.push(
        `import type * as Generated from ${JSON.stringify(generatedModule)};`
    );
    // This generic describes serialization, not any payload shape. Homomorphic
    // array/tuple/object mapping retains optional and readonly modifiers.
    entryLines.push(`
type CanonicalWire<T> =
    T extends string ? \`\${T}\` :
    T extends number ? \`\${T}\` extends \`\${infer N extends number}\` ? N : T :
    T extends readonly unknown[] ? { [K in keyof T]: CanonicalWire<T[K]> } :
    T extends object ? { [K in keyof T]: CanonicalWire<T[K]> } : T;
// API portability requires structural substitutability in both directions.
// Generic-function identity rejects equivalent alias/intersection forms; the
// explicit assignments below independently diagnose every nested difference.
// Tuple wrapping prevents a union from passing via distributive conditionals.
type EquivalentContract<A, B> =
    [A] extends [B] ? [B] extends [A] ? true : false : false;
type AssertContract<T extends true> = T;
`);
    for (const [
        index,
        { operation, input, output },
    ] of operationAliases.entries()) {
        for (const [kind, canonical, map] of [
            ['Input', input, 'CanonicalOperationInputs'],
            ['Output', output, 'CanonicalOperationOutputs'],
        ]) {
            const sourceType = `CanonicalWire<${canonical}>`;
            const generatedType = `CanonicalWire<Generated.${map}[${JSON.stringify(operation)}]>`;
            // Real assignments expose the exact nested mismatch; a generic
            // type-level boolean alone cannot diagnose structural differences.
            entryLines.push(`
// ${operation} ${kind.toLowerCase()}: verify both assignment directions.
declare const canonical${kind}${index}: ${sourceType};
declare const generated${kind}${index}: ${generatedType};
const generatedFromCanonical${kind}${index}: ${generatedType} = canonical${kind}${index};
const canonicalFromGenerated${kind}${index}: ${sourceType} = generated${kind}${index};
`);
            if (!diagnose)
                entryLines.push(
                    `type Verify${kind}${index} = AssertContract<EquivalentContract<${sourceType}, ${generatedType}>>;`
                );
        }
    }
}

const configuration = ts.readConfigFile(
    path.join(monorepo, 'tsconfig.json'),
    ts.sys.readFile
);
if (configuration.error)
    throw new Error(
        ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n')
    );
const parsedConfiguration = ts.parseJsonConfigFileContent(
    configuration.config,
    ts.sys,
    monorepo
);
const options = {
    ...parsedConfiguration.options,
    incremental: false,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
};
const host = ts.createCompilerHost(options);
const originalReadFile = host.readFile.bind(host);
host.readFile = (file) =>
    path.resolve(file) === entryName
        ? entryLines.join('\n')
        : originalReadFile(file);
const originalFileExists = host.fileExists.bind(host);
host.fileExists = (file) =>
    path.resolve(file) === entryName || originalFileExists(file);
const program = ts.createProgram([entryName], options, host);
const checker = program.getTypeChecker();
const entry = program.getSourceFile(entryName);
if (!entry) throw new Error('Canonical contract entry was not resolved.');
const assertSemanticEntry = () => {
    const diagnostics = program.getSemanticDiagnostics(entry);
    if (diagnostics.length) {
        throw new Error(
            ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                getCanonicalFileName: (file) => file,
                getCurrentDirectory: () => monorepo,
                getNewLine: () => '\n',
            })
        );
    }
};
if (diagnose) {
    assertSemanticEntry();
    console.log(
        JSON.stringify({
            mode: 'diagnose',
            sourceRevision: revision,
            operationCount: operationAliases.length,
            bidirectionalAssignmentPairsVerified: operationAliases.length * 2,
        })
    );
    process.exit(0);
}
for (const operation of operationAliases) {
    const aliasName = operation.routeType ?? operation.kindType;
    const declaration = entry.statements.find(
        (node) =>
            ts.isTypeAliasDeclaration(node) && node.name.text === aliasName
    );
    const value = checker.getTypeFromTypeNode(declaration.type).value;
    const expected =
        operation.transport === 'v1' ? operation.route : operation.kind;
    if (value !== expected)
        throw new Error(
            `Canonical route or procedure kind changed: ${operation.operation}`
        );
    delete operation.routeType;
    delete operation.kindType;
}

const names = new Map();
const declarations = [];
const sourceFiles = new Set();
const externalFiles = new Set();
const pending = [];
const usedNames = new Set();
const recordSource = (node) => {
    if (!node) return;
    const file = node.getSourceFile().fileName;
    if (file === entryName) return;
    if (file.includes('/node_modules/')) externalFiles.add(file);
    else if (file.startsWith(`${monorepo}/`))
        sourceFiles.add(path.relative(monorepo, file));
};
const recordType = (type) => {
    for (const symbol of [type.aliasSymbol, type.symbol]) {
        for (const declaration of symbol?.declarations ?? [])
            recordSource(declaration);
    }
};
const primitive = (type) => {
    const flags = type.flags;
    if (flags & ts.TypeFlags.StringLiteral) return JSON.stringify(type.value);
    if (flags & ts.TypeFlags.NumberLiteral) return String(type.value);
    if (flags & ts.TypeFlags.BooleanLiteral) return type.intrinsicName;
    if (flags & ts.TypeFlags.String) return 'string';
    if (flags & ts.TypeFlags.Number) return 'number';
    if (flags & ts.TypeFlags.Boolean) return 'boolean';
    if (flags & ts.TypeFlags.Null) return 'null';
    if (flags & ts.TypeFlags.Undefined) return 'undefined';
    if (flags & ts.TypeFlags.Void) return 'void';
    if (flags & ts.TypeFlags.Never) return 'never';
    if (flags & ts.TypeFlags.Unknown) return 'unknown';
    if (flags & ts.TypeFlags.Any)
        throw new Error(
            `Canonical payload contains any: ${checker.typeToString(type)}`
        );
    return null;
};
const nameType = (type, preferredName) => {
    if (names.has(type)) return names.get(type);
    let candidate =
        preferredName ?? type.aliasSymbol?.name ?? type.symbol?.name;
    if (
        !candidate ||
        !/^[A-Za-z_$][\w$]*$/.test(candidate) ||
        candidate.startsWith('__')
    )
        candidate = `ContractType${names.size}`;
    // Internal canonical names such as Array/Record must never shadow the
    // standard-library types used by emitted declarations.
    if (preferredName == null) candidate = `Contract_${candidate}`;
    let name = candidate;
    for (let suffix = 2; usedNames.has(name); suffix++)
        name = `${candidate}${suffix}`;
    usedNames.add(name);
    names.set(type, name);
    pending.push({ type, name });
    if (names.size > 15000)
        throw new Error(
            'Canonical wire type closure exceeded its safety bound.'
        );
    return name;
};
const reference = (type) => {
    recordType(type);
    return primitive(type) ?? nameType(type);
};
const describe = (type) => {
    recordType(type);
    const atomic = primitive(type);
    if (atomic != null) return atomic;
    if (type.isUnion()) return type.types.map(reference).join(' | ');
    if (type.isIntersection()) return type.types.map(reference).join(' & ');
    if (checker.isTupleType(type)) {
        const items = checker.getTypeArguments(type);
        return `${type.target.readonly ? 'readonly ' : ''}[${items
            .map((item, index) => {
                const flags = type.target.elementFlags[index];
                if (flags & ts.ElementFlags.Rest)
                    return `...${reference(item)}[]`;
                if (flags & ts.ElementFlags.Variadic)
                    return `...${reference(item)}`;
                return `${reference(item)}${flags & ts.ElementFlags.Optional ? '?' : ''}`;
            })
            .join(', ')}]`;
    }
    if (type.symbol?.name === 'ReadonlyArray')
        return `ReadonlyArray<${reference(checker.getTypeArguments(type)[0])}>`;
    if (checker.isArrayType(type))
        return `Array<${reference(checker.getTypeArguments(type)[0])}>`;
    if (type.flags & ts.TypeFlags.TemplateLiteral) {
        return (
            '`' +
            type.texts
                .map(
                    (text, index) =>
                        text.replaceAll('`', '\\`') +
                        (index < type.types.length
                            ? '${' + reference(type.types[index]) + '}'
                            : '')
                )
                .join('') +
            '`'
        );
    }
    if (!(type.flags & ts.TypeFlags.Object))
        throw new Error(
            `Unresolved canonical type: ${checker.typeToString(type)}`
        );
    if (
        checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
        checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length
    ) {
        throw new Error(
            `Callable canonical payload is not a plain JSON contract: ${checker.typeToString(type)}`
        );
    }
    const members = checker.getPropertiesOfType(type).map((property) => {
        for (const declaration of property.declarations ?? [])
            recordSource(declaration);
        if (property.name.startsWith('__@'))
            throw new Error(
                `Symbol key is not a plain JSON contract: ${property.name}`
            );
        const propertyType = checker.getTypeOfSymbolAtLocation(property, entry);
        const readonly = property.declarations?.some(
            (declaration) =>
                ts.getCombinedModifierFlags(declaration) &
                ts.ModifierFlags.Readonly
        );
        return `    ${readonly ? 'readonly ' : ''}${JSON.stringify(property.name)}${property.flags & ts.SymbolFlags.Optional ? '?' : ''}: ${reference(propertyType)};`;
    });
    for (const info of checker.getIndexInfosOfType(type)) {
        if (info.declaration) recordSource(info.declaration);
        members.push(
            `    ${info.isReadonly ? 'readonly ' : ''}[key: ${reference(info.keyType)}]: ${reference(info.type)};`
        );
    }
    return members.length ? `{\n${members.join('\n')}\n}` : '{}';
};

const exportedAliases = entry.statements
    .filter(ts.isTypeAliasDeclaration)
    .filter((node) =>
        node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    );
const exported = [];
for (const alias of exportedAliases) {
    const type = checker.getTypeFromTypeNode(alias.type);
    const atomic = primitive(type);
    if (atomic != null)
        exported.push(`export type ${alias.name.text} = ${atomic};`);
    else {
        const name = nameType(type, alias.name.text);
        if (name !== alias.name.text)
            exported.push(`export type ${alias.name.text} = ${name};`);
    }
}
for (let index = 0; index < pending.length; index++) {
    const { type, name } = pending[index];
    declarations.push(
        `${exportedAliases.some((alias) => alias.name.text === name) ? 'export ' : ''}type ${name} = ${describe(type)};`
    );
}
const inputMap = operationAliases
    .map(
        ({ operation, input }) => `    ${JSON.stringify(operation)}: ${input};`
    )
    .join('\n');
const outputMap = operationAliases
    .map(
        ({ operation, output }) =>
            `    ${JSON.stringify(operation)}: ${output};`
    )
    .join('\n');
const transportMap = operationAliases
    .map(
        ({ operation, transport, route, kind }) =>
            `    ${JSON.stringify(operation)}: { transport: ${JSON.stringify(transport)}; route: ${JSON.stringify(route)}; kind: ${JSON.stringify(kind)} };`
    )
    .join('\n');
const generated = await prettier.format(
    `// Generated by scripts/generate-runtime-contracts.mjs; do not edit.\n// Canonical monorepo revision: ${revision}\n// Enum values are emitted as their JSON string/number literals.\n\n${[...exported, ...declarations].join('\n\n')}\n\nexport type CanonicalOperationInputs = {\n${inputMap}\n};\n\nexport type CanonicalOperationOutputs = {\n${outputMap}\n};\n\nexport type CanonicalOperationTransports = {\n${transportMap}\n};\n`,
    {
        ...JSON.parse(
            readFileSync(path.join(sdkRoot, '.prettierrc.json'), 'utf8')
        ),
        parser: 'typescript',
    }
);
// Resolve and snapshot canonical declarations before verification-only mapped
// aliases can warm the checker's caches and alter union member ordering. Every
// mode still validates the entry before checking or writing either artifact.
assertSemanticEntry();

// Provenance covers contract declarations and canonical procedure construction,
// not unrelated files that the compiler happens to load from the app router.
for (const [, module] of v1) sourceFiles.add(`types/api/types/${module}.ts`);
sourceFiles.add('backend-src/trpc/index.ts');
sourceFiles.add('backend-src/trpc/routers.ts');
sourceFiles.add('backend-src/trpc/airtable/trpcRoute.ts');
sourceFiles.add('backend-src/trpc/publicExtensions/trpcRoute.ts');
sourceFiles.add('types/api/routes.ts');
for (const [, group, procedure] of trpc) {
    const directory = path.join(
        monorepo,
        `backend-src/trpc/${group}/${procedure}`
    );
    const files = program
        .getSourceFiles()
        .filter(
            (file) =>
                file.fileName === `${directory}.ts` ||
                file.fileName.startsWith(`${directory}/`)
        );
    for (const file of files)
        if (!file.fileName.includes('/__tests__/'))
            sourceFiles.add(path.relative(monorepo, file.fileName));
}
const sources = [...sourceFiles].sort().map((file) => {
    const current = readFileSync(path.join(monorepo, file));
    const canonical = execFileSync('git', ['show', `${revision}:${file}`], {
        cwd: monorepo,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (!current.equals(canonical))
        throw new Error(`Canonical source drifted from ${revision}: ${file}`);
    return { path: file, sha256: hash(current) };
});
const dependencies = [...externalFiles]
    .filter((file) => !file.includes('/typescript/lib/'))
    .sort()
    .map((file) => ({
        path: file.slice(
            file.lastIndexOf('/node_modules/') + '/node_modules/'.length
        ),
        sha256: hash(readFileSync(file)),
    }));
const provenance =
    JSON.stringify(
        {
            sourceRepository: 'miniExtensions/monorepo',
            sourceRevision: revision,
            compilerVersion: ts.version,
            generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
            transport:
                'plain JSON; canonical enum literals; no runtime code or imports',
            operations: operationAliases,
            sources,
            dependencies,
            declarationCount: declarations.length,
            generatedSha256: hash(generated),
        },
        null,
        4
    ) + '\n';
if (check) {
    const recordedGenerated = readFileSync(generatedFile, 'utf8');
    const recordedProvenance = readFileSync(provenanceFile, 'utf8');
    if (recordedGenerated !== generated || recordedProvenance !== provenance) {
        const previous = JSON.parse(recordedProvenance);
        const next = JSON.parse(provenance);
        const changedProvenanceFields = Object.keys(next).filter(
            (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])
        );
        const previousLines = recordedGenerated.split('\n');
        const nextLines = generated.split('\n');
        const changedLine = nextLines.findIndex(
            (line, index) => line !== previousLines[index]
        );
        throw new Error(
            'Generated runtime contracts are stale. ' +
                JSON.stringify({
                    recordedGeneratedSha256: hash(recordedGenerated),
                    currentGeneratedSha256: hash(generated),
                    changedProvenanceFields,
                    firstChangedGeneratedLine:
                        changedLine < 0
                            ? null
                            : {
                                  line: changedLine + 1,
                                  recorded: previousLines[changedLine],
                                  current: nextLines[changedLine],
                              },
                })
        );
    }
} else {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(generatedFile, generated);
    writeFileSync(provenanceFile, provenance);
}
console.log(
    JSON.stringify({
        mode: check ? 'check' : 'generate',
        canonicalParityVerified: verify,
        sourceRevision: revision,
        operationCount: operationAliases.length,
        declarationCount: declarations.length,
        bytes: Buffer.byteLength(generated),
        sourceCount: sources.length,
        externalDeclarationCount: dependencies.length,
        generatedSha256: hash(generated),
    })
);
