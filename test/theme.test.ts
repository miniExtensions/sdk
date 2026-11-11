import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    ALL_THEME_COLORS,
    DEFAULT_THEME_COLOR,
    getThemeStyles,
} from '../src/ui/index.js';
import { nativeThemePalettes } from './fixtures/themePalettes.js';

it('projects the exact 27 native palettes and ten ordered raw RGB tones', () => {
    assert.equal(DEFAULT_THEME_COLOR, 'blue');
    assert.deepEqual(
        ALL_THEME_COLORS,
        nativeThemePalettes.map(([name]) => name)
    );
    for (const [name, tones] of nativeThemePalettes) {
        const tokens = getThemeStyles(name);
        assert.deepEqual(
            Object.keys(tokens),
            [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(
                (tone) => `--theme-${tone}`
            )
        );
        assert.deepEqual(Object.values(tokens), tones);
    }
    assert.equal(getThemeStyles('indigo')['--theme-600'], '79 70 229');
});

it('returns an independent projection without changing later callers', () => {
    const tokens = getThemeStyles('blue');
    Object.assign(tokens, { '--theme-600': '1 2 3' });
    assert.equal(getThemeStyles('blue')['--theme-600'], '37 99 235');
});
