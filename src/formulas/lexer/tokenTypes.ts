enum TokenTypes {
    // single character tokens.
    LEFT_PAREN,
    RIGHT_PAREN,
    LESS_THAN,
    GREATER_THAN,
    COMMA,
    MINUS,
    PLUS,
    FSLASH,
    STAR,
    EQUAL_TO,
    AMPERSAND,

    // literals
    STRING,
    NUMBER,
    IDENTIFIER,

    // multi character tokens.
    NOT_EQ,
    GREATER_THAN_EQ,
    LESS_THAN_EQ,
}

export default TokenTypes;
