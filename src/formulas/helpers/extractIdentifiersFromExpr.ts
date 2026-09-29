import { assertUnreachable } from '../valueConversion.js';
import Lexer from '../lexer/lexer.js';
import {
    Binary,
    Literal,
    Unary,
    FunctionCall,
    Grouping,
    Identifier,
    type Expr,
} from '../parser/ast.js';
import Parser from '../parser/parser.js';

/**
 * Recursively traverses a formula expression tree and returns a list of identifiers (field references) used.
 */
export const extractIdentifiersFromExpr: (expr: Expr) => string[] = (expr) => {
    if (expr instanceof Literal) return [];
    if (expr instanceof Binary)
        return extractIdentifiersFromExpr(expr.left).concat(
            extractIdentifiersFromExpr(expr.right)
        );
    if (expr instanceof FunctionCall)
        return expr.arguments.reduce((acc, curr) => {
            return acc.concat(extractIdentifiersFromExpr(curr));
        }, [] as string[]);
    if (expr instanceof Grouping) return extractIdentifiersFromExpr(expr.expr);
    if (expr instanceof Unary) return extractIdentifiersFromExpr(expr.left);
    if (expr instanceof Identifier) return [String(expr.value)];
    assertUnreachable(expr);
};

export const extractIdentifiersFromFormula: (formula: string) => string[] = (
    formula
) => {
    return extractIdentifiersFromExpr(
        new Parser(new Lexer(formula).tokenize()).parse()
    );
};
