/// <reference lib="es2023.intl" />
// Private shared Calendar dependency boundary. Public component props expose
// host data and semantic actions; they do not expose this vendor API.
// The normal build bundles this one closure in both formats with React peers
// external, preserving the separate collaborator/scanner vendor graph.
export {
    I18nProvider,
    mergeProps,
    useButton,
    useCalendar,
    useCalendarCell,
    useCalendarGrid,
    useFocusRing,
    useListBox,
    useLocale,
    useOption,
    type AriaButtonOptions,
    type AriaListBoxProps,
} from 'calendar-react-aria';
export {
    Item,
    useCalendarState,
    useListState,
    type CalendarState,
    type ListState,
    type Node,
    type Selection,
} from 'react-stately';
export {
    createCalendar,
    getWeeksInMonth,
    parseDate,
    type CalendarDate,
} from '@internationalized/date';
