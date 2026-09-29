import type TokenTypes from './tokenTypes.js';

type StringToken = {
    type: Exclude<TokenTypes, TokenTypes.NUMBER>;
    value?: string;
};

type NumberToken = {
    type: TokenTypes.NUMBER;
    value: number;
};

export type Token = StringToken | NumberToken;
export type TokenArray = Token[];
