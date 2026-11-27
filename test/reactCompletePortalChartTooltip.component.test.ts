import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ChartOptions } from 'chart.js';
import { Window } from 'happy-dom';
import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompletePortalChart } from '../src/react/CompletePortalChart.js';

it('localizes small tooltip values while retaining ordered raw text pairs', (t) => {
    const points = [
        ['A', 0.0004],
        ['B', 0.0003],
        ['Negative', -0.0004],
    ] as const;
    const chartElement = CompletePortalChart({
        rows: points.map(([xAxisValue, yAxisValue]) => ({
            data: {
                type: 'loaded',
                data: { viewType: 'chart', xAxisValue, yAxisValue },
            },
        })),
        fieldName: 'Linked requests',
        xAxisFieldName: 'Name',
        yAxisFieldName: 'Amount',
        backgroundColor: 'rgb(37 99 235)',
    });
    const window = new Window();
    t.after(() => window.happyDOM.close());
    const host = window.document.createElement('div');
    host.innerHTML = renderToStaticMarkup(chartElement);
    assert.equal(
        host.querySelector('canvas')?.getAttribute('aria-hidden'),
        'true'
    );
    assert.deepEqual(
        [...host.querySelectorAll('dl > div')].map((row) => [
            row.querySelector('dt')?.textContent,
            row.querySelector('dd')?.textContent,
        ]),
        points.map(([name, value]) => [name, String(value)])
    );

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
