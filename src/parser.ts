/**
 * Boolean query parser for The Archive search syntax.
 *
 * Supports:
 *  - Implicit AND between adjacent tokens
 *  - Explicit AND, OR, NOT (ALL CAPS only)
 *  - ! prefix as NOT shorthand
 *  - "phrase search" with double quotes
 *  - Parenthetical grouping
 *  - Backslash escaping (\! \AND etc.)
 *  - No correct operator precedence (deliberate — matches The Archive)
 *
 * Grammar:
 *   Expression := Term ( OR Term )*
 *   Term       := Factor ( (AND | implicit) Factor )*
 *   Factor     := (NOT | !) Atom | Atom
 *   Atom       := PHRASE | WORD | '(' Expression ')'
 */

// ─── AST Node Types ──────────────────────────────────────────────

export type SearchNode =
    | { type: 'AND'; left: SearchNode; right: SearchNode }
    | { type: 'OR'; left: SearchNode; right: SearchNode }
    | { type: 'NOT'; operand: SearchNode }
    | { type: 'PHRASE'; value: string }
    | { type: 'WORD'; value: string };

// ─── Token Types ─────────────────────────────────────────────────

export enum TokenType {
    WORD = 'WORD',
    PHRASE = 'PHRASE',
    AND = 'AND',
    OR = 'OR',
    NOT = 'NOT',
    BANG = 'BANG',
    LPAREN = 'LPAREN',
    RPAREN = 'RPAREN',
    EOF = 'EOF',
}

export interface Token {
    type: TokenType;
    value: string;
}

// ─── Tokenizer ───────────────────────────────────────────────────

export function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < input.length) {
        const ch = input[i];

        // Skip whitespace
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        // Parentheses
        if (ch === '(') {
            tokens.push({ type: TokenType.LPAREN, value: '(' });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ type: TokenType.RPAREN, value: ')' });
            i++;
            continue;
        }

        // Phrase (double-quoted string)
        if (ch === '"') {
            i++; // skip opening quote
            let phrase = '';
            while (i < input.length && input[i] !== '"') {
                if (input[i] === '\\' && i + 1 < input.length) {
                    // Escaped character inside phrase
                    i++; // skip backslash
                    phrase += input[i];
                } else {
                    phrase += input[i];
                }
                i++;
            }
            if (i < input.length) {
                i++; // skip closing quote
            }
            tokens.push({ type: TokenType.PHRASE, value: phrase });
            continue;
        }

        // Backslash escape (outside phrases)
        if (ch === '\\' && i + 1 < input.length) {
            i++; // skip backslash
            // Read the escaped character(s) as a word
            let word = '';
            // If escaping the start of a keyword, consume the whole word
            const rest = input.slice(i);
            const wordMatch = rest.match(/^[^\s()"\\]+/);
            if (wordMatch) {
                word = wordMatch[0];
                i += word.length;
            } else {
                word = input[i];
                i++;
            }
            tokens.push({ type: TokenType.WORD, value: word });
            continue;
        }

        // ! (bang) — NOT shorthand
        if (ch === '!') {
            tokens.push({ type: TokenType.BANG, value: '!' });
            i++;
            continue;
        }

        // Read a word (non-whitespace, non-special characters)
        let word = '';
        while (i < input.length && !/[\s()"\\]/.test(input[i])) {
            // Don't consume ! if it's at the start of the next token
            if (input[i] === '!' && word.length > 0) {
                break;
            }
            word += input[i];
            i++;
        }

        if (word.length > 0) {
            // Check for operators (ALL CAPS only)
            if (word === 'AND') {
                tokens.push({ type: TokenType.AND, value: 'AND' });
            } else if (word === 'OR') {
                tokens.push({ type: TokenType.OR, value: 'OR' });
            } else if (word === 'NOT') {
                tokens.push({ type: TokenType.NOT, value: 'NOT' });
            } else {
                tokens.push({ type: TokenType.WORD, value: word });
            }
        }
    }

    tokens.push({ type: TokenType.EOF, value: '' });
    return tokens;
}

// ─── Parser ──────────────────────────────────────────────────────

class Parser {
    private tokens: Token[];
    private pos: number;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
        this.pos = 0;
    }

    private peek(): Token {
        return this.tokens[this.pos];
    }

    private consume(): Token {
        const token = this.tokens[this.pos];
        this.pos++;
        return token;
    }

    private match(type: TokenType): boolean {
        if (this.peek().type === type) {
            this.consume();
            return true;
        }
        return false;
    }

    /**
     * Expression := Term ( OR Term )*
     */
    parseExpression(): SearchNode | null {
        let left = this.parseTerm();
        if (!left) return null;

        while (this.peek().type === TokenType.OR) {
            this.consume(); // eat OR
            const right = this.parseTerm();
            if (!right) break;
            left = { type: 'OR', left, right };
        }

        return left;
    }

    /**
     * Term := Factor ( (AND | implicit) Factor )*
     *
     * Implicit AND: if the next token is a WORD, PHRASE, BANG, NOT, or LPAREN
     * (i.e., the start of another factor), treat it as AND.
     */
    private parseTerm(): SearchNode | null {
        let left = this.parseFactor();
        if (!left) return null;

        while (true) {
            const next = this.peek();

            // Explicit AND
            if (next.type === TokenType.AND) {
                this.consume(); // eat AND
                const right = this.parseFactor();
                if (!right) break;
                left = { type: 'AND', left, right };
                continue;
            }

            // Implicit AND — next token starts a new factor
            if (
                next.type === TokenType.WORD ||
                next.type === TokenType.PHRASE ||
                next.type === TokenType.BANG ||
                next.type === TokenType.NOT ||
                next.type === TokenType.LPAREN
            ) {
                const right = this.parseFactor();
                if (!right) break;
                left = { type: 'AND', left, right };
                continue;
            }

            break;
        }

        return left;
    }

    /**
     * Factor := (NOT | !) Atom | Atom
     */
    private parseFactor(): SearchNode | null {
        const next = this.peek();

        if (next.type === TokenType.NOT) {
            this.consume(); // eat NOT
            const operand = this.parseAtom();
            if (!operand) return null;
            return { type: 'NOT', operand };
        }

        if (next.type === TokenType.BANG) {
            this.consume(); // eat !
            const operand = this.parseAtom();
            if (!operand) return null;
            return { type: 'NOT', operand };
        }

        return this.parseAtom();
    }

    /**
     * Atom := PHRASE | WORD | '(' Expression ')'
     */
    private parseAtom(): SearchNode | null {
        const next = this.peek();

        if (next.type === TokenType.PHRASE) {
            this.consume();
            return { type: 'PHRASE', value: next.value };
        }

        if (next.type === TokenType.WORD) {
            this.consume();
            return { type: 'WORD', value: next.value };
        }

        if (next.type === TokenType.LPAREN) {
            this.consume(); // eat (
            const expr = this.parseExpression();
            if (this.peek().type === TokenType.RPAREN) {
                this.consume(); // eat )
            }
            return expr;
        }

        return null;
    }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Parse a search query string into an AST.
 * Returns null if the query is empty or invalid.
 */
export function parseQuery(input: string): SearchNode | null {
    if (!input || !input.trim()) return null;
    const tokens = tokenize(input);
    const parser = new Parser(tokens);
    return parser.parseExpression();
}
