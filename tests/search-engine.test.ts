/**
 * Unit tests for the search engine evaluation logic.
 * Tests are decoupled from Obsidian API by testing evaluate() directly.
 */

import { describe, it, expect } from 'vitest';
import { SearchEngine, IndexEntry, SnippetPiece } from '../src/search-engine';
import { parseQuery, SearchNode } from '../src/parser';
import { extractSearchTerms } from '../src/editor-highlight';
import { TFile } from 'obsidian';

// ─── Test Helpers ────────────────────────────────────────────────

/** Create a mock IndexEntry for testing evaluate(). */
function mockEntry(filename: string, content: string): IndexEntry {
    return {
        file: { path: filename + '.md', basename: filename } as unknown as TFile,
        filename: filename.toLowerCase(),
        content: content.toLowerCase(),
        rawContent: content,
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

// ─── Snippet Extraction Tests ────────────────────────────────────

describe('SearchEngine snippet extraction', () => {
    function createEngine() {
        return new (SearchEngine as any)(
            { vault: { getMarkdownFiles: () => [] } },
            { sortOrder: 'a-z', excludedFolders: [], respectObsidianExcluded: false }
        );
    }

    function getPieces(query: string, filename: string, content: string): SnippetPiece[] | undefined {
        const ast = parseQuery(query);
        const terms = ast ? extractSearchTerms(ast) : [];
        const entry = mockEntry(filename, content);
        return (createEngine() as any).extractSnippet(entry, terms);
    }

    function joinPieces(pieces: SnippetPiece[] | undefined): string | undefined {
        return pieces?.map(p => p.text).join('');
    }

    function getSnippet(query: string, filename: string, content: string): string | undefined {
        return joinPieces(getPieces(query, filename, content));
    }

    function hits(pieces: SnippetPiece[] | undefined): string[] {
        return (pieces ?? []).filter(p => p.hit).map(p => p.text);
    }

    it('produces snippet for simple word match', () => {
        const snip = getSnippet('art', 'f', 'this is the art of war and much longer text here to pad beyond the window size with extra filler content');
        expect(snip).toBeDefined();
        expect(snip).toContain('art');
        expect(snip!.length).toBeLessThanOrEqual(120);
    });

    it('produces snippet for phrase match', () => {
        const snip = getSnippet('"hello world"', 'f', 'say hello world today followed by padding text to trigger truncation ellipsis in the window');
        expect(snip).toBeDefined();
        expect(snip).toContain('hello world');
    });

    it('produces snippet for AND query using first positive term', () => {
        const snip = getSnippet('foo bar', 'f', 'zzz bar early then foo later with lots of padding text to fill the snippet window area here');
        expect(snip).toBeDefined();
        expect(snip).toContain('foo');
    });

    it('produces snippet for OR query', () => {
        const snip = getSnippet('foo OR bar', 'f', 'only the bar term appears in this long content string with padding padding padding padding');
        expect(snip).toBeDefined();
        expect(snip).toContain('bar');
    });

    it('ignores NOT branches for snippet selection', () => {
        const content = 'bar appears first in the text then foo appears much later with padding to separate';
        const snip = getSnippet('foo !bar', 'f', content);
        expect(snip).toBeDefined();
        expect(snip).toContain('foo');
        expect(snip!.indexOf('foo')).toBeLessThan(snip!.length - 5);
    });

    it('empty query returns result without snippet', () => {
        const snip = getSnippet('', 'f', 'some content here');
        expect(snip).toBeUndefined();
    });

    it('pure NOT query returns no snippet', () => {
        const snip = getSnippet('!bar', 'f', 'hello world no bar');
        expect(snip).toBeUndefined();
    });

    it('no snippet when positive terms only match filename not content', () => {
        const snip = getSnippet('foo', 'myfoo', 'content without the term at all here with padding');
        expect(snip).toBeUndefined();
    });

    it('search() populates snippet for matching results', () => {
        const engine = createEngine();
        const entry = mockEntry('note1', 'this note has the special keyword inside its long body text with enough padding characters here');
        (engine as any).index.set('/note1.md', entry);
        const results = engine.search('special');
        expect(results.length).toBe(1);
        expect(results[0].snippet).toBeDefined();
        expect(joinPieces(results[0].snippet)).toContain('special');
        expect(results[0]).toHaveProperty('snippet');
    });

    it('allFilesSorted returns results without snippets', () => {
        const engine = createEngine();
        const entry = mockEntry('note2', 'foo bar baz');
        (engine as any).index.set('/note2.md', entry);
        const results = (engine as any).allFilesSorted();
        expect(results.length).toBe(1);
        expect(results[0].snippet).toBeUndefined();
    });

    it('keeps the note\'s original capitalization and marks the hit', () => {
        const pieces = getPieces('spaced', 'f', 'Notes on Spaced Repetition for study');
        expect(joinPieces(pieces)).toBe('Notes on Spaced Repetition for study');
        expect(hits(pieces)).toEqual(['Spaced']);
    });

    it('matches case-insensitively in either direction', () => {
        expect(hits(getPieces('SPACED', 'f', 'about spaced repetition'))).toEqual(['spaced']);
        expect(hits(getPieces('Spaced', 'f', 'about SPACED repetition'))).toEqual(['SPACED']);
    });

    it('marks every occurrence of every term in the window', () => {
        const pieces = getPieces('foo OR bar', 'f', 'Foo then BAR then foo again');
        expect(hits(pieces)).toEqual(['Foo', 'BAR', 'foo']);
    });

    it('marks phrase hits as one piece', () => {
        const pieces = getPieces('"hello world"', 'f', 'say Hello World today');
        expect(hits(pieces)).toEqual(['Hello World']);
    });

    it('pieces carry ellipses as non-hit text in original case', () => {
        const content = 'Intro '.repeat(30) + 'Needle ' + 'Outro '.repeat(30);
        const pieces = getPieces('needle', 'f', content)!;
        expect(pieces[0]).toEqual({ text: '... ', hit: false });
        expect(pieces[pieces.length - 1]).toEqual({ text: '...', hit: false });
        expect(hits(pieces)).toEqual(['Needle']);
        expect(joinPieces(pieces)).toContain('Intro');
    });

    it('search() returns original-case pieces', () => {
        const engine = createEngine();
        (engine as any).index.set('/n.md', mockEntry('n', 'A note on Spaced Repetition'));
        const results = engine.search('spaced');
        expect(hits(results[0].snippet)).toEqual(['Spaced']);
    });
});
