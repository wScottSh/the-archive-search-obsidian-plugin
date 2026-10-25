import { describe, it, expect } from 'vitest';
import { insertOperator, Operator } from '../src/operator-insert';

/** `|` marks the caret and `[..]` a selection, in both input and expected output. */
function run(input: string, operator: Operator) {
    const open = input.indexOf('[');
    const close = input.indexOf(']');
    let value: string, start: number, end: number;
    if (open >= 0) {
        value = input.replace('[', '').replace(']', '');
        start = open;
        end = close - 1;
    } else {
        start = end = input.indexOf('|');
        value = input.replace('|', '');
    }
    const r = insertOperator(value, start, end, operator);
    return r.value.slice(0, r.caret) + '|' + r.value.slice(r.caret);
}

describe('insertOperator', () => {
    const cases: [string, Operator, string][] = [
        // phrase / group: caret between vs wrap
        ['|', 'phrase', '"|"'],
        ['foo |', 'phrase', 'foo "|"'],
        ['[foo]', 'phrase', '"foo"|'],
        ['a [b c] d', 'phrase', 'a "b c"| d'],
        ['|', 'group', '(|)'],
        ['foo |bar', 'group', 'foo (|)bar'],
        ['[foo bar]', 'group', '(foo bar)|'],
        // OR spacing: start, after a space, after a word, before existing text
        ['|', 'or', 'OR |'],
        ['foo|', 'or', 'foo OR |'],
        ['foo |', 'or', 'foo OR |'],
        ['foo |bar', 'or', 'foo OR |bar'],
        ['foo| bar', 'or', 'foo OR |bar'],
        ['foo [bar]', 'or', 'foo OR |'],
        // NOT inserts !
        ['|', 'not', '!|'],
        ['foo|', 'not', 'foo !|'],
        ['foo |', 'not', 'foo !|'],
        ['(|', 'not', '(!|'],
        ['foo [bar]', 'not', 'foo !bar|'],
        // tag
        ['|', 'tag', '#|'],
        ['foo |', 'tag', 'foo #|'],
        ['foo [bar]', 'tag', 'foo #bar|'],
    ];

    it.each(cases)('%s + %s -> %s', (input, operator, expected) => {
        expect(run(input, operator)).toBe(expected);
    });

    it('clamps an out-of-range selection and orders a reversed one', () => {
        expect(insertOperator('ab', 5, 9, 'phrase')).toEqual({ value: 'ab""', caret: 3 });
        expect(insertOperator('abc', 2, 0, 'group')).toEqual({ value: '(ab)c', caret: 4 });
    });
});
