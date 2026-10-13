import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
    Lexer,
    Parser,
    Literal,
    Binary,
    Unary,
    TokenTypes,
    extractIdentifiersFromExpr,
} from '../src/formulas/index.js';

const parse = (source: string, maxDepth?: number) =>
    new Parser(new Lexer(source).tokenize({ cache: false })).parse({
        cache: false,
        maxDepth,
    });
const tokenLimit = {
    name: 'RangeError',
    message: 'Formula token limit exceeded',
};
const depthLimit = {
    name: 'RangeError',
    message: 'Formula depth limit exceeded',
};

describe('opt-in formula parsing bounds', () => {
    it('preserves deep input compatibility in fresh Node processes', () => {
        // Isolate each case so JIT warmup from other tests cannot mask it.
        for (const [prefix, suffix, depth, maxDepth] of [
            ['-', '', 4000],
            ['-', '', 6000],
            ['-', '', 8000],
            ['(', ')', 500],
            ['SUM(', ')', 500],
            ['(', ')', 950],
            ['SUM(', ')', 950],
            ['-(', ')', 850],
            ['-SUM(', ')', 850],
            ['--(', ')', 780],
            ['--SUM(', ')', 780],
            ['---(', ')', 710],
            ['---SUM(', ')', 710],
            ['-(', ')', 700, 1401],
            ['-SUM(', ')', 700, 1401],
            ['--(', ')', 600, 1801],
            ['--SUM(', ')', 600, 1801],
        ] as const) {
            // Preserve the default-stack unary and 500-level witnesses. Higher
            // nesting needs an explicit budget across architectures; Linux x64
            // also retains the 984 KiB witness that catches the larger frame.
            const stackSizes =
                prefix === '-' || depth === 500
                    ? [undefined]
                    : process.platform === 'linux' && process.arch === 'x64'
                      ? [2048, 984]
                      : [2048];
            for (const stackSize of stackSizes) {
                execFileSync(
                    process.execPath,
                    [
                        ...(stackSize === undefined
                            ? []
                            : [`--stack-size=${stackSize}`]),
                        '--input-type=module',
                        '--eval',
                        `
                import assert from 'node:assert/strict';
                import {Lexer, Parser} from ${JSON.stringify(new URL('../src/formulas/index.js', import.meta.url).href)};
                const source = ${JSON.stringify(prefix)}.repeat(${depth}) + '1' + ${JSON.stringify(suffix)}.repeat(${depth});
                const tokens = new Lexer(source).tokenize();
                const maxDepth = ${maxDepth};
                const expression = new Parser(tokens).parse({maxDepth});
                assert.ok(expression);
                if (maxDepth === undefined) {
                    assert.strictEqual(new Parser(tokens).parse(), expression);
                } else {
                    assert.throws(() => new Parser(tokens).parse({maxDepth:maxDepth-1}), {
                        name: 'RangeError', message: 'Formula depth limit exceeded'
                    });
                }
                assert.notStrictEqual(new Parser(tokens).parse({cache:false,maxDepth}), expression);
            `,
                    ],
                    { timeout: 15000 }
                );
            }
        }
    });
    it('parses cold unary chains with a small stack and exact depth bounds', () => {
        for (const maxDepth of [undefined, 8001]) {
            execFileSync(
                process.execPath,
                [
                    '--stack-size=256',
                    '--input-type=module',
                    '--eval',
                    `
                import assert from 'node:assert/strict';
                import {Lexer, Parser, Unary, Literal} from ${JSON.stringify(new URL('../src/formulas/index.js', import.meta.url).href)};
                const tokens = new Lexer('-'.repeat(8000) + '1').tokenize({cache:false});
                let expression = new Parser(tokens).parse({cache:false,maxDepth:${maxDepth}});
                for (let index = 0; index < 8000; index++) {
                    assert.ok(expression instanceof Unary);
                    assert.strictEqual(expression.operator, tokens[index]);
                    expression = expression.left;
                }
                assert.ok(expression instanceof Literal);
                assert.equal(expression.value, 1);
                assert.throws(() => new Parser(tokens).parse({maxDepth:8000}), {
                    name: 'RangeError', message: 'Formula depth limit exceeded'
                });
            `,
                ],
                { timeout: 15000 }
            );
        }
    });
    it('retains unary operator identity and multiplication precedence', () => {
        const tokens = new Lexer('--1*-2').tokenize({ cache: false });
        const expected = new Binary(
            tokens[3]!,
            new Unary(tokens[0]!, new Unary(tokens[1]!, new Literal(1))),
            new Unary(tokens[4]!, new Literal(2))
        );
        for (const maxDepth of [undefined, 4]) {
            assert.deepEqual(
                new Parser(tokens).parse({ cache: false, maxDepth }),
                expected
            );
        }
        assert.throws(() => parse('--1*-2', 3), depthLimit);
        for (const source of ['-', '--', '-*1']) {
            assert.throws(() => parse(source), {
                message: 'Expected an expression',
            });
        }
        assert.throws(() => parse('--1 2'), { message: 'Invalid expression' });
    });
    it('accepts exact token limits and ignores trailing whitespace', () => {
        assert.equal(
            new Lexer('1 + 2 \n').tokenize({ maxTokens: 3 }).length,
            3
        );
        assert.deepEqual(new Lexer(' \n').tokenize({ maxTokens: 0 }), []);
        assert.throws(
            () => new Lexer('1 + 2').tokenize({ maxTokens: 2 }),
            tokenLimit
        );
        assert.throws(
            () => new Lexer('1').tokenize({ maxTokens: 0 }),
            tokenLimit
        );
    });
    it('stops before scanning the next token or malformed suffix', () => {
        assert.throws(
            () =>
                new Lexer('1 "unterminated').tokenize({
                    cache: false,
                    maxTokens: 1,
                }),
            tokenLimit
        );
        assert.throws(
            () => new Lexer('1 {unterminated').tokenize({ maxTokens: 1 }),
            tokenLimit
        );
        const seeded = new Lexer('', [{ type: TokenTypes.NUMBER, value: 1 }]);
        assert.throws(
            () => seeded.tokenize({ cache: false, maxTokens: 0 }),
            tokenLimit
        );
    });
    it('bounds a large token stream at the requested 8192 boundary', () => {
        const source = '1 '.repeat(8192);
        assert.equal(
            new Lexer(source).tokenize({ cache: false, maxTokens: 8192 })
                .length,
            8192
        );
        assert.throws(
            () =>
                new Lexer(source + '"unterminated').tokenize({
                    cache: false,
                    maxTokens: 8192,
                }),
            tokenLimit
        );
    });
    it('validates limits even when the input was previously cached', () => {
        const tokens = new Lexer('723 + 4').tokenize();
        new Parser(tokens).parse();
        for (const maxTokens of [
            -1,
            0.5,
            NaN,
            Infinity,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            assert.throws(() => new Lexer('723 + 4').tokenize({ maxTokens }), {
                name: 'RangeError',
                message: 'maxTokens must be a non-negative safe integer',
            });
        }
        for (const maxDepth of [
            0,
            -1,
            0.5,
            NaN,
            Infinity,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            assert.throws(() => new Parser(tokens).parse({ maxDepth }), {
                name: 'RangeError',
                message: 'maxDepth must be a positive safe integer',
            });
        }
        assert.throws(
            () => new Lexer('723 + 4').tokenize({ maxTokens: 2 }),
            tokenLimit
        );
        assert.throws(
            () => new Parser(tokens).parse({ maxDepth: 1 }),
            depthLimit
        );
    });
    for (const [name, make] of [
        [
            'grouping',
            (n: number) => '('.repeat(n - 1) + '1' + ')'.repeat(n - 1),
        ],
        ['unary', (n: number) => '-'.repeat(n - 1) + '1'],
        [
            'functions',
            (n: number) => 'SUM('.repeat(n - 1) + '1' + ')'.repeat(n - 1),
        ],
        ['binary', (n: number) => Array(n).fill('1').join('+')],
    ] as const) {
        it(`enforces exact AST depth for ${name}`, () => {
            assert.doesNotThrow(() => parse(make(48), 48));
            assert.throws(() => parse(make(49), 48), depthLimit);
            assert.doesNotThrow(() => parse(make(49)));
            assert.throws(() => parse(make(20000), 48), depthLimit);
        });
    }
    it('accepts leaf/empty-call depth 1 and bounds mixed nested expressions', () => {
        assert.ok(parse('1', 1) instanceof Literal);
        assert.doesNotThrow(() => parse('SUM()', 1));
        assert.throws(() => parse('SUM(1)', 1), depthLimit);
        assert.doesNotThrow(() => parse('SUM(-(1+2), 3)', 5));
        assert.throws(() => parse('SUM(-(1+2), 3)', 4), depthLimit);
        assert.deepEqual(
            extractIdentifiersFromExpr(parse('{Price}+SUM({Tax})', 3)),
            ['Price', 'Tax']
        );
    });
    it('stops recursive descent before a malformed deeply nested suffix', () => {
        for (const prefix of ['(', '-', 'SUM(']) {
            const tokens = new Lexer(prefix.repeat(10000) + '1').tokenize({
                cache: false,
            });
            assert.throws(
                () => new Parser(tokens).parse({ maxDepth: 48 }),
                depthLimit
            );
        }
    });
    it('rejects before reading tokens beyond the depth budget', () => {
        for (const source of [
            '-'.repeat(100),
            '('.repeat(100),
            'SUM('.repeat(100),
            Array(100).fill('1').join('+'),
        ]) {
            const tokens = new Lexer(source).tokenize({ cache: false });
            Object.defineProperty(tokens, 99, {
                get() {
                    throw new Error('Read beyond bounded prefix');
                },
            });
            assert.throws(
                () => new Parser(tokens).parse({ maxDepth: 48 }),
                depthLimit
            );
        }
    });
    it('bounds every binary precedence level and wide calls', () => {
        for (const operator of [
            '=',
            '!=',
            '>',
            '>=',
            '<',
            '<=',
            '+',
            '-',
            '&',
            '*',
            '/',
        ]) {
            assert.doesNotThrow(() =>
                parse(Array(48).fill('1').join(operator), 48)
            );
            assert.throws(
                () => parse(Array(49).fill('1').join(operator), 48),
                depthLimit
            );
        }
        assert.doesNotThrow(() =>
            parse('SUM(' + Array(4095).fill('1').join(',') + ')', 2)
        );
        assert.throws(() => parse('SUM(1+2)', 2), depthLimit);
    });
    it('never caches a partial failed result or a bounded AST', () => {
        const source = 'SUM({NoPartialCache},813)';
        assert.throws(
            () => new Lexer(source).tokenize({ maxTokens: 2 }),
            tokenLimit
        );
        const tokens = new Lexer(source).tokenize();
        assert.equal(tokens.length, 6);
        assert.throws(
            () => new Parser(tokens).parse({ maxDepth: 1 }),
            depthLimit
        );
        const bounded = new Parser(tokens).parse({ maxDepth: 2 });
        assert.notStrictEqual(new Parser(tokens).parse(), bounded);
    });
    it('preserves default cache identity and bypasses both cache reads and writes', () => {
        const source = '{UncachedParserWitness}+711';
        const first = new Lexer(source).tokenize({ cache: false });
        const cached = new Lexer(source).tokenize();
        assert.notStrictEqual(first, cached);
        assert.strictEqual(new Lexer(source).tokenize(), cached);
        assert.notStrictEqual(
            new Lexer(source).tokenize({ cache: false }),
            cached
        );
        const firstExpr = new Parser(cached).parse({ cache: false });
        const cachedExpr = new Parser(cached).parse();
        assert.notStrictEqual(firstExpr, cachedExpr);
        assert.strictEqual(new Parser(cached).parse(), cachedExpr);
        assert.notStrictEqual(
            new Parser(cached).parse({ cache: false }),
            cachedExpr
        );
        assert.notStrictEqual(
            new Parser(cached).parse({ maxDepth: 2 }),
            cachedExpr
        );
        assert.strictEqual(new Parser(cached).parse(), cachedExpr);
    });
});
