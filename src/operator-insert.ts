/**
 * Pure insertion logic for the mobile operator row.
 *
 * (value, selection, operator) -> (new value, caret). No DOM access, so the
 * modal only has to apply the result to the input.
 */

export type Operator = 'phrase' | 'group' | 'or' | 'not' | 'tag';

export interface OperatorEdit {
    value: string;
    caret: number;
}

const WRAPPERS: Record<'phrase' | 'group', [string, string]> = {
    phrase: ['"', '"'],
    group: ['(', ')'],
};

/**
 * Apply an operator to `value` with the selection [start, end].
 *
 * - phrase / group: wrap the selection, or put the caret between an empty pair
 * - or: insert `OR` with a space on each side, never doubling an existing one
 * - not: prefix the selection (or caret) with `!`
 * - tag: prefix the selection (or caret) with `#`, spaced off a preceding word like not
 */
export function insertOperator(value: string, start: number, end: number, operator: Operator): OperatorEdit {
    const from = Math.min(value.length, Math.max(0, Math.min(start, end)));
    const to = Math.min(value.length, Math.max(0, Math.max(start, end)));
    const before = value.slice(0, from);
    const selected = value.slice(from, to);
    const after = value.slice(to);

    switch (operator) {
        case 'phrase':
        case 'group': {
            const [open, close] = WRAPPERS[operator];
            const caret = from + open.length + selected.length + (selected ? close.length : 0);
            return { value: before + open + selected + close + after, caret };
        }
        case 'or': {
            const lead = before === '' || /\s$/.test(before) ? '' : ' ';
            const inserted = lead + 'OR';
            // Reuse a space already after the caret instead of doubling it
            const trail = /^\s/.test(after) ? '' : ' ';
            return { value: before + inserted + trail + after, caret: from + inserted.length + 1 };
        }
        case 'not':
        case 'tag': {
            const mark = operator === 'not' ? '!' : '#';
            const lead = before === '' || /[\s(!]$/.test(before) ? '' : ' ';
            return {
                value: before + lead + mark + selected + after,
                caret: from + lead.length + 1 + selected.length,
            };
        }
    }
}
