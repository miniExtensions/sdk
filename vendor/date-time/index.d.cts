import type { Component, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { Moment } from 'moment';
declare class Datetime extends Component<{
    value: Moment | string;
    open: boolean;
    closeOnClickOutside: boolean;
    renderInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'defaultValue' | 'children'>): ReactElement;
    renderDay(props: HTMLAttributes<HTMLDivElement> & { key: string }, date: Moment): ReactElement;
    renderView(view: string, renderCalendar: () => ReactNode): ReactElement;
    onChange(value: string | Moment): void;
    onBeforeNavigate(next: string, previous: string, date: Moment): string;
    dateFormat: string;
    timeFormat: string | false;
    isValidDate(date: Moment): boolean;
    closeOnSelect: boolean;
    updateOnView: string;
    onOpen(): void;
    onClose(): void;
    onNavigate(view: string): void;
    locale: string;
    displayTimeZone?: string;
}> {
    navigate(view: string): void;
    setViewDate(date: Date): void;
}
export = Datetime;
