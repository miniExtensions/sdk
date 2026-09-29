import type { Token } from '../lexer/token.js';

export interface ASTNode {
    accept<R>(visitor: Visitor<R>): R;
}

export interface Visitor<T> {
    visitBinaryExpr(node: Binary): T;
    visitLiteralExpr(node: Literal): T;
    visitUnaryExpr(node: Unary): T;
    visitFunctionCallExpr(node: FunctionCall): T;
    visitGroupExpr(node: Grouping): T;
    visitIdentifierExpr(node: Identifier): T;
}

/**
 * The expression interface of the parser uses a visitor pattern.
 *
 * The various expression nodes implement from the {@link ASTNode} interface,
 * which requires a method accept which has one parameter a visitor.
 *
 * The visitor should implement the {@link Visitor} interfaces which implement
 * the require visit* methods.
 *
 * When the accept method is called on a node with a visitor, the node
 * then calls the, appropriate method within the visitor.
 *
 * For example, {@link Expr.Binary} will call visitBinaryExpr on
 * the visitor passed in with accept.
 *
 * @remarks
 *
 * See https://en.wikipedia.org/wiki/Visitor_pattern for more information on the visitor pattern.
 *
 *
 */
export type Expr =
    | Literal
    | Binary
    | Unary
    | Grouping
    | FunctionCall
    | Identifier;
export class Binary implements ASTNode {
    constructor(
        private _operator: Token,
        private _left: Expr,
        private _right: Expr
    ) {}
    accept<T>(visitor: Visitor<T>) {
        return visitor.visitBinaryExpr(this);
    }

    get operator() {
        return this._operator;
    }

    get left() {
        return this._left;
    }

    get right() {
        return this._right;
    }
}

export class Literal implements ASTNode {
    constructor(private _value: string | number) {}

    accept<T>(visitor: Visitor<T>) {
        return visitor.visitLiteralExpr(this);
    }

    get value() {
        return this._value;
    }
}

/**
 * Represents a resolvable token such as a field reference or a function name
 */
export class Identifier implements ASTNode {
    constructor(private _value: string | number) {}

    accept<T>(visitor: Visitor<T>): T {
        return visitor.visitIdentifierExpr(this);
    }

    get value() {
        return this._value;
    }
}

export class Grouping implements ASTNode {
    constructor(private _expr: Expr) {}

    accept<T>(visitor: Visitor<T>): T {
        return visitor.visitGroupExpr(this);
    }

    get expr() {
        return this._expr;
    }
}

export class Unary implements ASTNode {
    constructor(
        private _operator: Token,
        private _left: Expr
    ) {}

    accept<T>(visitor: Visitor<T>) {
        return visitor.visitUnaryExpr(this);
    }

    get operator() {
        return this._operator;
    }

    get left() {
        return this._left;
    }
}

export class FunctionCall implements ASTNode {
    constructor(
        private _callee: string,
        private _arguments: Expr[]
    ) {}

    accept<T>(visitor: Visitor<T>) {
        return visitor.visitFunctionCallExpr(this);
    }

    get callee() {
        return this._callee;
    }

    get arguments() {
        return this._arguments;
    }
}
