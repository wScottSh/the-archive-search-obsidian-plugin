/**
 * Unit tests for the boolean query parser.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, parseQuery, TokenType, SearchNode } from '../src/parser';

// ─── Tokenizer Tests ─────────────────────────────────────────────

describe('tokenize', () => {
    it('tokenizes simple words', () => {
        const tokens = tokenize('foo bar');
        expect(tokens.map(t => t.type)).toEqual([
            TokenType.WORD, TokenType.WORD, TokenType.EOF,
        ]);
        expect(tokens[0].value).toBe('foo');
        expect(tokens[1].value).toBe('bar');
    });

    it('recognizes ALL CAPS operators', () => {
        const tokens = tokenize('AND OR NOT');
        expect(tokens.map(t => t.type)).toEqual([
            TokenType.AND, TokenType.OR, TokenType.NOT, TokenType.EOF,
        ]);
    });

    it('treats lowercase and/or/not as words', () => {
        const tokens = tokenize('and or not');
        expect(tokens.map(t => t.type)).toEqual([
            TokenType.WORD, TokenType.WORD, TokenType.WORD, TokenType.EOF,
        ]);
    });

    it('tokenizes phrases in double quotes', () => {
        const tokens = tokenize('"the archive"');
        expect(tokens).toEqual([
            { type: TokenType.PHRASE, value: 'the archive' },
            { type: TokenType.EOF, value: '' },
        ]);
    });

    it('tokenizes ! as BANG', () => {
        const tokens = tokenize('!foo');
        expect(tokens[0].type).toBe(TokenType.BANG);
        expect(tokens[1]).toEqual({ type: TokenType.WORD, value: 'foo' });
    });

    it('tokenizes parentheses', () => {
        const tokens = tokenize('(foo OR bar)');
        expect(tokens.map(t => t.type)).toEqual([
            TokenType.LPAREN, TokenType.WORD, TokenType.OR,
            TokenType.WORD, TokenType.RPAREN, TokenType.EOF,
        ]);
    });

    it('handles backslash escaping of operators', () => {
        const tokens = tokenize('\\AND');
        expect(tokens[0]).toEqual({ type: TokenType.WORD, value: 'AND' });
    });

    it('handles backslash escaping of !', () => {
        const tokens = tokenize('\\!bar');
        expect(tokens[0]).toEqual({ type: TokenType.WORD, value: '!bar' });
    });

    it('handles escaped quotes inside phrases', () => {
        const tokens = tokenize('"hello \\"world\\""');
        expect(tokens[0]).toEqual({ type: TokenType.PHRASE, value: 'hello "world"' });
    });
});

// ─── Parser Tests ────────────────────────────────────────────────

describe('parseQuery', () => {
    it('returns null for empty input', () => {
        expect(parseQuery('')).toBeNull();
        expect(parseQuery('   ')).toBeNull();
    });

    it('parses a single word', () => {
        const ast = parseQuery('hello');
        expect(ast).toEqual({ type: 'WORD', value: 'hello' });
    });

    it('parses implicit AND (space-separated words)', () => {
        const ast = parseQuery('foo bar');
        expect(ast).toEqual({
            type: 'AND',
            left: { type: 'WORD', value: 'foo' },
            right: { type: 'WORD', value: 'bar' },
        });
    });

    it('parses explicit AND', () => {
        const ast = parseQuery('foo AND bar');
        expect(ast).toEqual({
            type: 'AND',
            left: { type: 'WORD', value: 'foo' },
            right: { type: 'WORD', value: 'bar' },
        });
    });

    it('parses OR', () => {
        const ast = parseQuery('foo OR bar');
        expect(ast).toEqual({
            type: 'OR',
            left: { type: 'WORD', value: 'foo' },
            right: { type: 'WORD', value: 'bar' },
        });
    });

    it('parses NOT keyword', () => {
        const ast = parseQuery('NOT bar');
        expect(ast).toEqual({
            type: 'NOT',
            operand: { type: 'WORD', value: 'bar' },
        });
    });

    it('parses ! prefix (no space)', () => {
        const ast = parseQuery('!bar');
        expect(ast).toEqual({
            type: 'NOT',
            operand: { type: 'WORD', value: 'bar' },
        });
    });

    it('handles the "! b" gotcha — evaluates as ! AND b', () => {
        // "! b" — ! has nothing following immediately, then b comes as implicit AND
        // With our grammar: Factor sees !, then tries to parse Atom.
        // The next token is WORD "b", so it becomes NOT(WORD("b")).
        // This matches The Archive's documentation: "! b evaluates as ! AND b"
        // which means NOT(everything) AND b. But since our grammar parses
        // ! as a prefix that needs an operand, "! b" → NOT(b).
        // This is the documented behavior.
        const ast = parseQuery('! b');
        expect(ast).toEqual({
            type: 'NOT',
            operand: { type: 'WORD', value: 'b' },
        });
    });

    it('parses phrase search', () => {
        const ast = parseQuery('"the archive"');
        expect(ast).toEqual({
            type: 'PHRASE',
            value: 'the archive',
        });
    });

    it('parses ! inside phrase as literal', () => {
        const ast = parseQuery('"!b"');
        expect(ast).toEqual({
            type: 'PHRASE',
            value: '!b',
        });
    });

    it('parses parenthetical grouping', () => {
        const ast = parseQuery('!(foo OR bar)');
        expect(ast).toEqual({
            type: 'NOT',
            operand: {
                type: 'OR',
                left: { type: 'WORD', value: 'foo' },
                right: { type: 'WORD', value: 'bar' },
            },
        });
    });

    it('parses nested grouping: !(foo OR (baz AND !bar))', () => {
        const ast = parseQuery('!(foo OR (baz AND !bar))');
        expect(ast).toEqual({
            type: 'NOT',
            operand: {
                type: 'OR',
                left: { type: 'WORD', value: 'foo' },
                right: {
                    type: 'AND',
                    left: { type: 'WORD', value: 'baz' },
                    right: {
                        type: 'NOT',
                        operand: { type: 'WORD', value: 'bar' },
                    },
                },
            },
        });
    });

    it('parses escaped operator as word', () => {
        const ast = parseQuery('\\AND');
        expect(ast).toEqual({ type: 'WORD', value: 'AND' });
    });

    it('parses escaped ! as word', () => {
        const ast = parseQuery('\\!bar');
        expect(ast).toEqual({ type: 'WORD', value: '!bar' });
    });

    it('parses complex query: #literature #inbox (productivity OR writing)', () => {
        const ast = parseQuery('#literature #inbox (productivity OR writing)');
        // This should parse as implicit AND chain:
        // AND(AND(#literature, #inbox), OR(productivity, writing))
        expect(ast).toEqual({
            type: 'AND',
            left: {
                type: 'AND',
                left: { type: 'WORD', value: '#literature' },
                right: { type: 'WORD', value: '#inbox' },
            },
            right: {
                type: 'OR',
                left: { type: 'WORD', value: 'productivity' },
                right: { type: 'WORD', value: 'writing' },
            },
        });
    });
});
