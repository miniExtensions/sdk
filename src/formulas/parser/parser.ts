/**
 * Airtable Formula Grammar
 *
 *
 * expression       -> equality
 * equality         -> comparison ( ( "!=" | "=" ) comparison )*
 * comparison       -> term ( ( ">" | ">=" | "<" | "<=") term )*
 * term             -> factor ( ( "-" | "+" | "&" ) factor )*
 * factor           -> unary ( ( "/" | "*" ) unary )*
 * unary            -> ("-") unary | function_call
 * primary          -> NUMBER | STRING | grouping | field_reference | IDENTIFIER
 * function_call    -> primary ( "(" arguments? ")" )*
 * arguments        -> expression ( "," expression )*
 * field_reference  -> "{" [\S\d[:space:]]+ "}"
 */

import type { Token, TokenArray } from '../lexer/token.js';
import TokenTypes from '../lexer/tokenTypes.js';
import {
    Binary,
    type Expr,
    Unary,
    Identifier,
    FunctionCall,
    Grouping,
    Literal,
} from './ast.js';

export interface ParseOptions {
    /** Use the shared AST cache. Defaults to true; bounded parses always bypass it. */
    cache?: boolean;
    /** Maximum AST depth (a leaf has depth 1); a positive safe integer. */
    maxDepth?: number;
}

const ParserCache = new Map<TokenArray, Expr>();

export default class Parser {
    private currentTokenIndex = 0;
    private maxDepth: number | undefined;
    private nestingDepth = 1;
    private nodeDepths = new WeakMap<Expr, number>();
    constructor(private tokens: TokenArray) {}

    parse({ cache = true, maxDepth }: ParseOptions = {}) {
        if (
            maxDepth !== undefined &&
            (!Number.isSafeInteger(maxDepth) || maxDepth < 1)
        ) {
            throw new RangeError('maxDepth must be a positive safe integer');
        }
        this.maxDepth = maxDepth;
        // A cached AST may be arbitrarily deep. Reparse bounded input so limits
        // apply during construction without recursively walking cached objects.
        const useCache = cache && maxDepth === undefined;
        if (useCache && ParserCache.has(this.tokens)) {
            return ParserCache.get(this.tokens)!;
        }
        const expr = this.expression();
        if (!this.isAtEnd()) throw new Error('Invalid expression');
        if (useCache) ParserCache.set(this.tokens, expr);
        return expr;
    }

    private enterNested() {
        if (this.nestingDepth >= this.maxDepth!) {
            throw new RangeError('Formula depth limit exceeded');
        }
        this.nestingDepth++;
    }

    private nestedExpression(): Expr {
        this.enterNested();
        try {
            return this.expression();
        } finally {
            this.nestingDepth--;
        }
    }

    private boundedUnary(operator: Token): Expr {
        this.enterNested();
        let left: Expr;
        try {
            left = this.unary();
        } finally {
            this.nestingDepth--;
        }
        return this.bounded(new Unary(operator, left), [left]);
    }

    private bounded<T extends Expr>(
        expr: T,
        children: readonly Expr[] = []
    ): T {
        if (this.maxDepth !== undefined) {
            let depth = 1;
            for (const child of children)
                depth = Math.max(depth, 1 + this.nodeDepths.get(child)!);
            if (this.nestingDepth + depth - 1 > this.maxDepth) {
                throw new RangeError('Formula depth limit exceeded');
            }
            this.nodeDepths.set(expr, depth);
        }
        return expr;
    }

    private expression() {
        return this.equality();
    }

    private equality() {
        let expr = this.comparison();

        while (this.match(TokenTypes.NOT_EQ, TokenTypes.EQUAL_TO)) {
            const operator = this.previous();
            const right = this.comparison();
            expr = this.bounded(new Binary(operator, expr, right), [
                expr,
                right,
            ]);
        }

        return expr;
    }

    private comparison() {
        let expr = this.term();

        while (
            this.match(
                TokenTypes.GREATER_THAN,
                TokenTypes.GREATER_THAN_EQ,
                TokenTypes.LESS_THAN,
                TokenTypes.LESS_THAN_EQ
            )
        ) {
            const operator = this.previous();
            const right = this.term();
            expr = this.bounded(new Binary(operator, expr, right), [
                expr,
                right,
            ]);
        }

        return expr;
    }

    private term() {
        let expr = this.factor();

        while (
            this.match(TokenTypes.MINUS, TokenTypes.PLUS, TokenTypes.AMPERSAND)
        ) {
            const operator = this.previous();
            const right = this.factor();
            expr = this.bounded(new Binary(operator, expr, right), [
                expr,
                right,
            ]);
        }

        return expr;
    }

    private factor() {
        let expr = this.unary();

        while (this.match(TokenTypes.FSLASH, TokenTypes.STAR)) {
            const operator = this.previous();
            const right = this.unary();
            expr = this.bounded(new Binary(operator, expr, right), [
                expr,
                right,
            ]);
        }

        return expr;
    }

    private unary(): Expr {
        if (this.match(TokenTypes.MINUS)) {
            const operator = this.previous();
            if (this.maxDepth !== undefined) return this.boundedUnary(operator);
            // Preserve the original direct recursion and stack shape by keeping
            // bounded callbacks/helpers out of the default path.
            const left: Expr = this.unary();
            return new Unary(operator, left);
        }

        return this.functionCall();
    }

    private functionCall() {
        const expr = this.primary();

        if (this.match(TokenTypes.LEFT_PAREN)) {
            if (!(expr instanceof Identifier))
                throw new Error('Only identifiers can be called.');
            return this.functionArguments(expr.value as string);
        }

        return expr;
    }
    /**
     * Parses the arguments of the function call in the formula.
     * Once it finishes the {@link currentTokenIndex} will point to the next token after the function call.
     */
    private functionArguments(callee: string) {
        const fnArguments: Expr[] = [];

        if (!this.check(TokenTypes.RIGHT_PAREN)) {
            do {
                fnArguments.push(
                    this.maxDepth === undefined
                        ? this.expression()
                        : this.nestedExpression()
                );
            } while (this.match(TokenTypes.COMMA));
        }

        this.consume(TokenTypes.RIGHT_PAREN);

        return this.bounded(new FunctionCall(callee, fnArguments), fnArguments);
    }

    private primary() {
        if (
            this.match(
                TokenTypes.STRING,
                TokenTypes.IDENTIFIER,
                TokenTypes.NUMBER
            )
        ) {
            const prevValue = this.previous().value;

            // This shouldn't be possible but let's be on the safe side
            // So we know it's a problem with the parser or lexer and not the formula.
            // Empty strings and 0 are valid values that's why we aren't using !prevValue
            if (prevValue == null) throw new Error('literal token as no value');

            return this.previous().type === TokenTypes.IDENTIFIER
                ? this.bounded(new Identifier(prevValue))
                : this.bounded(new Literal(prevValue));
        }

        if (this.match(TokenTypes.LEFT_PAREN)) {
            const expr =
                this.maxDepth === undefined
                    ? this.expression()
                    : this.nestedExpression();
            this.consume(TokenTypes.RIGHT_PAREN);
            return this.bounded(new Grouping(expr), [expr]);
        }

        throw new Error('Expected an expression');
    }

    private match(...tokenTypes: TokenTypes[]) {
        const hasMatch = tokenTypes.some((tokenType) => this.check(tokenType));
        if (hasMatch) this.advance();

        return hasMatch;
    }

    private consume(tokenType: TokenTypes) {
        if (this.check(tokenType)) return this.advance();

        throw new Error('Expected token ' + tokenType);
    }

    private peek() {
        return this.tokens[this.currentTokenIndex];
    }

    private advance() {
        if (!this.isAtEnd()) return this.tokens[this.currentTokenIndex++];

        return null;
    }

    private previous() {
        return this.tokens[this.currentTokenIndex - 1];
    }

    private check(tokenType: TokenTypes) {
        if (this.isAtEnd()) return false;

        return this.peek().type === tokenType;
    }

    private isAtEnd() {
        return this.currentTokenIndex >= this.tokens.length;
    }
}
