import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ChartOptions } from 'chart.js';
import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CompletePortalChart,
    type CompletePortalChartProps,
    type PortalChartRow,
} from '../src/react/index.js';

const row = (xAxisValue: string, yAxisValue: number): PortalChartRow => ({
    data: {
        type: 'loaded',
        data: { viewType: 'chart', xAxisValue, yAxisValue },
    },
});
const defaults: CompletePortalChartProps = {
    rows: [],
    fieldName: 'Linked requests',
    xAxisFieldName: 'Name',
    yAxisFieldName: 'Amount',
    backgroundColor: 'rgb(37 99 235)',
};
const render = (rows: readonly PortalChartRow[]) =>
    renderToStaticMarkup(
        createElement(CompletePortalChart, { ...defaults, rows })
    );

it('server-imports the complete component without a DOM or canvas initialization', () => {
    const html = render([]);
    assert.match(html, /<canvas[^>]*aria-hidden="true"/);
    assert.match(html, /<dl class="mx-sdk-portal-chart__data"><\/dl>/);
    assert.ok(
        !html.includes('sr-only'),
        'does not depend on application Tailwind'
    );
});

it('renders matching ordered accessible chart pairs and retains duplicate labels and raw values', () => {
    const rows: readonly PortalChartRow[] = [
        row('Same label', 0),
        { data: { type: 'notLoaded' } },
        { data: { type: 'loading' } },
        { data: { type: 'loaded', data: { viewType: 'list' } } },
        row('Same label', -2.75),
        { data: { type: 'failed' } },
        { data: { type: 'loaded', data: { viewType: 'calendar' } } },
        row('Third & final', 4.5),
    ];
    const before = JSON.stringify(rows);
    const html = render(rows);
    assert.equal((html.match(/<dt>/g) ?? []).length, 3);
    assert.match(html, /<dt>Same label<\/dt><dd>0<\/dd>/);
    assert.match(html, /<dt>Same label<\/dt><dd>-2.75<\/dd>/);
    assert.match(html, /<dt>Third &amp; final<\/dt><dd>4.5<\/dd>/);
    assert.ok(html.indexOf('<dd>0') < html.indexOf('<dd>-2.75'));
    assert.equal(JSON.stringify(rows), before);
});

it('keeps loaded previous chart values readable across reload/error metadata and replaces empty projections', () => {
    const previous: PortalChartRow = {
        data: {
            type: 'loaded',
            data: { viewType: 'chart', xAxisValue: 'Retained', yAxisValue: 3 },
            isPaginating: true,
            isReloading: true,
            errorMessage: 'Retained native feedback',
        },
    };
    assert.match(render([previous]), /<dt>Retained<\/dt><dd>3<\/dd>/);
    const ignored = render([{ data: { type: 'loading' } }]);
    assert.ok(!ignored.includes('<dt>'));
    assert.ok(!ignored.includes('Retained'));
});

it('formats only nonzero tooltip values that the current scale rounds to signed zero', () => {
    const chartElement = CompletePortalChart(defaults);
    assert(isValidElement<{ children: ReactNode }>(chartElement));
    const [bar] = Children.toArray(chartElement.props.children);
    assert(isValidElement<{ options: ChartOptions<'bar'> }>(bar));
    const label = bar.props.options.plugins?.tooltip?.callbacks?.label;
    assert(label);

    for (const [locale, separator] of [
        ['en-US', '.'],
        ['de-DE', ','],
    ]) {
        const { format } = new Intl.NumberFormat(locale);
        const chart = {
            options: { locale },
            scales: { y: { getLabelForValue: format } },
        };
        const invoke = (raw: unknown, formattedValue: string): unknown =>
            Reflect.apply(label, undefined, [{ raw, formattedValue, chart }]);
        for (const [raw, expected] of [
            [0.0004, `0${separator}0004`],
            [0.0003, `0${separator}0003`],
            [-0.0004, `-0${separator}0004`],
        ] as const)
            assert.equal(invoke(raw, format(raw)), expected);
        for (const raw of [0, -0, 1.25, -2.75, NaN, Infinity])
            assert.equal(invoke(raw, format(raw)), undefined);
        assert.equal(invoke('0.0004', '0'), undefined);
    }
});
