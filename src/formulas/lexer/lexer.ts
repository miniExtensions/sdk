import type { TokenArray } from './token.js';
import TokenTypes from './tokenTypes.js';

const LexerCache = new Map<string, TokenArray>();
export default class Lexer {
    private currentCharIndex = 0;

    constructor(
        private source: string,
        private currentTokenStream: TokenArray = []
    ) {}

    /**
     *
     * @returns An array of {@link Token}s, each one representing a token in the {@link source}
     */
    tokenize() {
        if (LexerCache.has(this.source)) {
            return LexerCache.get(this.source)!;
        }
        while (!this.atEnd()) this._tokenize();
        LexerCache.set(this.source, this.currentTokenStream);
        return this.currentTokenStream;
    }

    private _tokenize() {
        const currentChar = this.advance();

        if (!currentChar) {
            throw new Error('End of source!');
        }

        switch (currentChar) {
            case ' ':
            case '\n':
                break;
            case '(':
                this.currentTokenStream.push({
                    type: TokenTypes.LEFT_PAREN,
                });
                break;
            case ')':
                this.currentTokenStream.push({
                    type: TokenTypes.RIGHT_PAREN,
                });
                break;
            case '&':
                this.currentTokenStream.push({
                    type: TokenTypes.AMPERSAND,
                });
                break;
            case '+':
                this.currentTokenStream.push({
                    type: TokenTypes.PLUS,
                });
                break;
            case '-':
                this.currentTokenStream.push({
                    type: TokenTypes.MINUS,
                });
                break;
            case '*':
                this.currentTokenStream.push({
                    type: TokenTypes.STAR,
                });
                break;
            case '=':
                this.currentTokenStream.push({
                    type: TokenTypes.EQUAL_TO,
                });
                break;
            case '/':
                this.currentTokenStream.push({
                    type: TokenTypes.FSLASH,
                });
                break;
            case '{':
                this.currentTokenStream.push({
                    type: TokenTypes.IDENTIFIER,
                    value: this.tokenizeFieldReference('}'),
                });
                if (!this.match('}'))
                    throw new Error('Unterminated field reference');
                break;
            case '!':
                if (!this.match('=')) {
                    this.unexpectedCharacter(this.currentCharIndex, '=');
                }

                this.currentTokenStream.push({
                    type: TokenTypes.NOT_EQ,
                });
                break;

            case '>':
                if (this.match('=')) {
                    this.currentTokenStream.push({
                        type: TokenTypes.GREATER_THAN_EQ,
                    });
                    break;
                }

                this.currentTokenStream.push({
                    type: TokenTypes.GREATER_THAN,
                });
                break;
            case ',':
                this.currentTokenStream.push({
                    type: TokenTypes.COMMA,
                });
                break;
            case '<':
                if (this.match('=')) {
                    this.currentTokenStream.push({
                        type: TokenTypes.LESS_THAN_EQ,
                    });
                    break;
                }

                this.currentTokenStream.push({
                    type: TokenTypes.LESS_THAN,
                });
                break;
            case "'":
            case '"':
                this.currentTokenStream.push({
                    type: TokenTypes.STRING,
                    value: this.tokenizeString(currentChar),
                });
                break;
            default:
                if (Lexer.isNumber(currentChar)) {
                    this.currentTokenStream.push({
                        type: TokenTypes.NUMBER,
                        value: this.tokenizeNumber(currentChar),
                    });
                } else if (Lexer.isAlpha(currentChar)) {
                    this.currentTokenStream.push({
                        type: TokenTypes.IDENTIFIER,
                        value: this.tokenizeIdentifier(currentChar),
                    });
                } else {
                    throw new Error('Unknown token ' + currentChar);
                }
        }
    }

    private unexpectedCharacter(col: number, expected: string) {
        throw new Error(
            `Unexpected character at col ${col} expected ${expected}`
        );
    }

    private tokenizeNumber(start: string) {
        let numStr = start;

        let nextChar = this.peek();

        while (nextChar && (Lexer.isNumber(nextChar) || nextChar === '.')) {
            numStr += nextChar;
            this.advance();
            nextChar = this.peek();
        }

        const number = Number(numStr);

        if (Number.isNaN(number)) throw new Error('Invalid Number');

        return number;
    }

    private isCharAhead(char: string) {
        return this.source.includes(char, this.currentCharIndex + 1);
    }

    private tokenizeString(terminator: "'" | '"') {
        let str = '';

        let nextChar = this.peek();

        while (nextChar && nextChar !== terminator) {
            if (nextChar === '\\') {
                this.advance();
                const newNext = this.peek();
                switch (newNext) {
                    case 'n':
                        this.advance();
                        str += '\n';
                        break;
                    case '\\':
                        this.advance();
                        str += '\\';
                        break;
                    case terminator:
                        if (this.isCharAhead(terminator)) {
                            str += terminator;
                            this.advance();
                        } else {
                            str += '\\';
                        }
                        break;
                    default:
                        // Escape escape
                        // if token isn't regonized
                        // or
                        // The character that wants to be escaped is not
                        // equal to the terminator used for the string.
                        // e.g "hello\'world". \' is a an uneeded escape
                        str += '\\';
                }
            } else {
                this.advance();
                str += nextChar;
            }

            nextChar = this.peek();
        }

        if (nextChar === terminator) {
            this.advance();
            return str;
        } else {
            throw new Error('Unterminated string');
        }
    }

    private tokenizeFieldReference(terminator: string) {
        let str = '';
        let nextChar = this.peek();

        while (nextChar && /[\S\s]/.test(nextChar) && nextChar !== terminator) {
            if (nextChar === '\\') {
                this.advance();
                const newNext = this.peek();

                switch (newNext) {
                    case terminator:
                    case '\\':
                        str += newNext;
                        this.advance();
                        break;

                    default:
                        str += '\\';
                }
            } else {
                this.advance();
                str += nextChar;
            }

            nextChar = this.peek();
        }

        return str;
    }

    private tokenizeIdentifier(start: string) {
        let str = start;

        let nextChar = this.peek();

        // Identifier with no spaces and parenthesis
        while (nextChar && /[^()\s]/.test(nextChar)) {
            str += nextChar;
            this.advance();
            nextChar = this.peek();
        }

        return str;
    }

    static isAlpha(char: string) {
        return /[a-zA-Z]/.test(char);
    }

    static isNumber(char: string) {
        return /[0-9]/.test(char);
    }

    private peek() {
        if (this.atEnd()) {
            return null;
        }

        return this.source[this.currentCharIndex];
    }
    private atEnd() {
        return this.currentCharIndex >= this.source.length;
    }

    private advance() {
        return this.source[this.currentCharIndex++];
    }
    private match(expectedChar: string) {
        if (this.atEnd()) return false;

        if (this.source[this.currentCharIndex] !== expectedChar) return false;

        ++this.currentCharIndex;
        return true;
    }
}
