import Interpreter from './interpreter/interpreter.js';
import type { InterpreterContext } from './interpreter/interpreter.js';
import Lexer from './lexer/lexer.js';
import Parser from './parser/parser.js';
import type { Expr as _Expr } from './parser/ast.js';

export default class FormulaRunner {
    private interpreter: Interpreter;
    private _expr: _Expr;

    constructor(source: string, doNotThrowForUnknownFields = false) {
        const lexer = new Lexer(source);
        const parser = new Parser(lexer.tokenize());
        this._expr = parser.parse();
        this.interpreter = new Interpreter(
            this.expr,
            doNotThrowForUnknownFields
        );
    }

    run() {
        return this.interpreter.execute();
    }

    static isErrorValue(value: unknown) {
        return (
            typeof value === 'number' &&
            (Number.isNaN(value) || !Number.isFinite(value))
        );
    }

    static isFalsyValue(value: unknown) {
        return (
            FormulaRunner.isErrorValue(value) ||
            value === 0 ||
            value === false ||
            value === '' ||
            (Array.isArray(value) && value.length === 0)
        );
    }
    get expr() {
        return this._expr;
    }

    set context(context: InterpreterContext) {
        this.interpreter.context = context;
    }
}
