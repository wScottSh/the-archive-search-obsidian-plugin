/**
 * Unit tests for the search engine evaluation logic.
 * Tests are decoupled from Obsidian API by testing evaluate() directly.
 */

import { describe, it, expect } from 'vitest';
import { SearchEngine, IndexEntry } from '../src/search-engine';
import { parseQuery, SearchNode } from '../src/parser';
import { TFile } from 'obsidian';

// ─── Test Helpers ────────────────────────────────────────────────

/** Create a mock IndexEntry for testing evaluate(). */
function mockEntry(filename: string, content: string): IndexEntry {
    return {
        file: { path: filename + '.md', basename: filename } as unknown as TFile,
        filename: filename.toLowerCase(),
        content: content.toLowerCase(),
        rawFilename: filename,
    };
}

/** Parse and evaluate a query against an entry. */
function matches(query: string, filename: string, content: string): boolean {
    const ast = parseQuery(query);
    if (!ast) return true; // empty query matches all
    // We access evaluate via prototype since it's a public method
    const engine = new (SearchEngine as any)(
        { vault: { getMarkdownFiles: () => [] } },
        { sortOrder: 'a-z', excludedFolders: [], respectObsidianExcluded: false }
    );
    return engine.evaluate(ast, mockEntry(filename, content));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('SearchEngine.evaluate', () => {
    describe('word matching', () => {
        it('matches substring in content', () => {
            expect(matches('art', 'myfile', 'the art of starting things')).toBe(true);
        });

        it('matches substring in filename', () => {
            expect(matches('note', 'mynote', '')).toBe(true);
        });

        it('is case-insensitive', () => {
            expect(matches('Hello', 'file', 'hello world')).toBe(true);
            expect(matches('hello', 'file', 'Hello World')).toBe(true);
        });

        it('does not match when term is absent', () => {
            expect(matches('xyz', 'myfile', 'hello world')).toBe(false);
        });

        it('matches substring (not whole word)', () => {
            expect(matches('art', 'file', 'starting')).toBe(true);
        });
    });

    describe('phrase matching', () => {
        it('matches exact phrase', () => {
            expect(matches('"hello world"', 'file', 'say hello world today')).toBe(true);
        });

        it('does not match words out of order', () => {
            expect(matches('"world hello"', 'file', 'hello world')).toBe(false);
        });

        it('does not match separated words', () => {
            expect(matches('"hello world"', 'file', 'hello big world')).toBe(false);
        });
    });

    describe('AND logic', () => {
        it('requires both terms to be present', () => {
            expect(matches('foo bar', 'file', 'foo and bar here')).toBe(true);
            expect(matches('foo bar', 'file', 'only foo here')).toBe(false);
            expect(matches('foo bar', 'file', 'only bar here')).toBe(false);
        });

        it('works with explicit AND', () => {
            expect(matches('foo AND bar', 'file', 'foo and bar')).toBe(true);
            expect(matches('foo AND bar', 'file', 'only foo')).toBe(false);
        });
    });

    describe('OR logic', () => {
        it('matches when either term is present', () => {
            expect(matches('foo OR bar', 'file', 'only foo')).toBe(true);
            expect(matches('foo OR bar', 'file', 'only bar')).toBe(true);
            expect(matches('foo OR bar', 'file', 'neither')).toBe(false);
        });
    });

    describe('NOT logic', () => {
        it('excludes files containing the term', () => {
            expect(matches('NOT bar', 'file', 'hello world')).toBe(true);
            expect(matches('NOT bar', 'file', 'hello bar')).toBe(false);
        });

        it('works with ! prefix', () => {
            expect(matches('!bar', 'file', 'hello world')).toBe(true);
            expect(matches('!bar', 'file', 'hello bar')).toBe(false);
        });
    });

    describe('complex queries', () => {
        it('handles AND + NOT: foo !bar', () => {
            expect(matches('foo !bar', 'file', 'foo here')).toBe(true);
            expect(matches('foo !bar', 'file', 'foo and bar')).toBe(false);
        });

        it('handles grouped OR + NOT: !(foo OR bar)', () => {
            expect(matches('!(foo OR bar)', 'file', 'nothing here')).toBe(true);
            expect(matches('!(foo OR bar)', 'file', 'has foo')).toBe(false);
            expect(matches('!(foo OR bar)', 'file', 'has bar')).toBe(false);
        });

        it('handles mixed: foo AND (bar OR baz)', () => {
            expect(matches('foo (bar OR baz)', 'file', 'foo bar')).toBe(true);
            expect(matches('foo (bar OR baz)', 'file', 'foo baz')).toBe(true);
            expect(matches('foo (bar OR baz)', 'file', 'foo only')).toBe(false);
        });
    });
});
