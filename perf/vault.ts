/**
 * Deterministic synthetic vault shaped like the device vault: 1723 notes,
 * Zettelkasten-style titles, log-normal sizes (median ~2 KB, a long tail of
 * large notes), a few folders including an excluded templates folder.
 */

import { TFile } from './obsidian-shim';

export const NOTE_COUNT = 1723;

const COMMON = (
    'the of and to in is that for it as with was on be by this are or from at which an have not but all they ' +
    'one had their there were been has more when will would who what about can if out so up into than them ' +
    'some could time these two may then do first any my now such like other how its our over only new also'
).split(' ');

const GAME_WORDS = ['game', 'games', 'gameplay', 'gamer', 'gaming'];

const SYLLABLES = (
    'ka ri to sen mar lo vi den sa tu re mo pla nek ti sor da fen bri cal mu tes ver go ha lin ab ex com pro ' +
    'gra gan ber ston wel fra dis ing tion ment ous ple ric ser val ant rol tri bu nig gal ry ly'
).split(' ');

const VOCABULARY_SIZE = 6000;
/** Share of notes about games; only those mention "game". */
const GAME_NOTE_SHARE = 0.18;

const FOLDERS = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'references', 'projects', 'journal', 'templates'];

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface Vault {
    files: TFile[];
    contents: Map<TFile, string>;
    totalChars: number;
}

export function makeVault(seed = 1): Vault {
    const random = mulberry32(seed);
    const vocabulary = Array.from({ length: VOCABULARY_SIZE }, () =>
        Array.from({ length: 1 + Math.floor(random() * 3) }, () => SYLLABLES[Math.floor(random() * SYLLABLES.length)]).join(''));
    const zipf = () => vocabulary[Math.min(VOCABULARY_SIZE - 1, Math.floor(Math.exp(random() * Math.log(VOCABULARY_SIZE))) - 1)];
    let gameNote = false;
    const word = () => {
        const roll = random();
        if (gameNote && roll < 0.01) return GAME_WORDS[Math.floor(random() * GAME_WORDS.length)];
        return roll < 0.45 ? COMMON[Math.floor(random() * COMMON.length)] : zipf();
    };
    const normal = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

    const files: TFile[] = [];
    const contents = new Map<TFile, string>();
    let totalChars = 0;
    const start = Date.UTC(2019, 0, 1);

    for (let i = 0; i < NOTE_COUNT; i++) {
        gameNote = random() < GAME_NOTE_SHARE;
        const created = start + Math.floor(random() * 7 * 365 * 86400000);
        const stamp = new Date(created).toISOString().replace(/\D/g, '').substring(0, 12);
        const titleWords = 2 + Math.floor(random() * 6);
        const title = Array.from({ length: titleWords }, word).join(' ');
        const folder = FOLDERS[Math.floor(random() * FOLDERS.length)];
        const path = `${folder ? folder + '/' : ''}${stamp} ${title}.md`;

        const size = Math.min(150000, Math.max(200, Math.round(2000 * Math.exp(normal()))));
        const parts: string[] = [`# ${title}\n\n`];
        let length = parts[0].length;
        while (length < size) {
            const sentence = Array.from({ length: 6 + Math.floor(random() * 14) }, word).join(' ');
            const roll = random();
            const piece = roll < 0.05 ? `[[${sentence}]]\n\n` : roll < 0.1 ? `#${word()} ${sentence}.\n\n` : `${sentence}. `;
            parts.push(piece);
            length += piece.length;
        }
        const content = parts.join('');
        const file = new TFile(path, created, created + Math.floor(random() * 86400000 * 30), content.length);
        files.push(file);
        contents.set(file, content);
        totalChars += content.length;
    }
    return { files, contents, totalChars };
}
