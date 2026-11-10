import { createElement, type ReactElement } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    type ChartData,
    type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

/** The already-readable values of a loaded native-compatible Chart row. */
export type PortalChartData = {
    readonly viewType: 'chart';
    readonly xAxisValue: string;
    readonly yAxisValue: number;
};

/**
 * A structural display boundary, not a record client or store. Additional
 * upstream record identity/metadata remains caller-owned. Loaded previous
 * data stays readable while pagination/reload/error metadata changes.
 */
export type PortalChartRow = {
    readonly data:
        | { readonly type: 'notLoaded' | 'loading' | 'failed' }
        | {
              readonly type: 'loaded';
              readonly data:
                  | PortalChartData
                  | { readonly viewType: 'list' | 'calendar' };
              readonly isPaginating?: boolean;
              readonly isReloading?: boolean;
              readonly errorMessage?: string;
          };
};

export type CompletePortalChartProps = {
    readonly rows: readonly PortalChartRow[];
    readonly title?: string | null;
    readonly fieldName: string;
    readonly xAxisFieldName: string;
    readonly yAxisFieldName: string;
    /** Portable ordinary CSS color; the caller retains its theme registry. */
    readonly backgroundColor: string;
};

// Match native Chart.tsx blob23cf604cc80273e7dc90fe2fd23fa2c7627ad66d.
// Registration is shared/idempotent; unmount destroys only owned instances,
// never unregistering classes that an unrelated consumer may still use.
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

/** Complete native-compatible vertical Bar and its accessible textual data. */
export function CompletePortalChart(
    props: CompletePortalChartProps
): ReactElement {
    const selected = props.rows.flatMap((row, index) =>
        row.data.type === 'loaded' && row.data.data.viewType === 'chart'
            ? [{ index, data: row.data.data }]
            : []
    );
    const labels = selected.map(({ data }) => data.xAxisValue);
    const values = selected.map(({ data }) => data.yAxisValue);
    const data: ChartData<'bar', number[], string> = {
        labels,
        datasets: [{ data: values, backgroundColor: props.backgroundColor }],
    };
    const options: ChartOptions<'bar'> = {
        scales: {
            y: {
                beginAtZero: true,
                title: { display: true, text: props.yAxisFieldName },
            },
            x: {
                title: { display: true, text: props.xAxisFieldName },
            },
        },
        responsive: true,
        plugins: {
            title: { display: true, text: props.title ?? props.fieldName },
            legend: { display: false },
        },
    };
    return createElement(
        'div',
        { className: 'mx-sdk-portal-chart' },
        createElement(Bar<number[], string>, {
            data,
            options,
            'aria-hidden': 'true',
        }),
        createElement(
            'dl',
            { className: 'mx-sdk-portal-chart__data' },
            selected.map(({ data, index }) =>
                createElement(
                    'div',
                    { key: index },
                    createElement('dt', null, data.xAxisValue),
                    createElement('dd', null, data.yAxisValue)
                )
            )
        )
    );
}
