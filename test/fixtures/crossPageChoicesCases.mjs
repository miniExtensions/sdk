import {
    conditionalField as field,
    conditionalRule as rule,
} from './conditionalPageValidationCases.mjs';

const make = (type, scenario, settings = {}) => {
    const driver = field('driver', 'singleLineText', {
        headerSectionTitle: 'First page',
        ...(settings.driverHidden
            ? {
                  conditionalFields: rule('is', 'yes', 'singleLineText', {
                      type: 'id',
                      id: 'show',
                  }),
              }
            : {}),
        ...(settings.hiddenSection
            ? {
                  applyFieldConditionsToSection: true,
                  conditionalFields: rule('is', 'yes', 'singleLineText', {
                      type: 'id',
                      id: 'show',
                  }),
              }
            : {}),
    });
    const choice = field('choice', type, {
        headerSectionTitle: 'Second page',
        enableConditionalOptions: true,
        conditionsForOptions: [
            {
                config: {
                    optionForConditions: 'sel_allow',
                    conditionsForOption: rule(),
                },
            },
        ],
    });
    choice.airtableField.config.options = {
        choices: [
            { id: 'sel_allow', name: 'Allowed' },
            { id: 'sel_always', name: 'Always' },
        ],
    };
    const schemas = {
        driver,
        witness: field('witness'),
        choice,
        show: field('show'),
    };
    if (settings.noReset) delete choice.miniExtConfig.headerSectionTitle;
    const data = {
        driver: settings.deny ? 'deny' : 'allow',
        witness: 'section witness',
        choice: type === 'singleSelect' ? 'Allowed' : ['Allowed'],
        show: settings.hide ? 'no' : 'yes',
        untouched: { text: 'native retained' },
    };
    return {
        name: `${type}/${scenario}`,
        fieldId: 'choice',
        pageMode: settings.defaultMode
            ? null
            : settings.onePage
              ? 'one-page'
              : 'multi-page',
        activePageIndex: settings.activePage ?? 1,
        rendererType: settings.list ? 'list' : 'dropdown',
        fieldIds: ['driver', 'witness', 'choice', 'show'],
        schemas,
        data,
    };
};
export const crossPageChoicesCases = [
    'singleSelect',
    'multipleSelects',
].flatMap((type) => [
    make(type, 'inactive-first-page-allows'),
    make(type, 'first-page-active-same-record', { activePage: 0 }),
    make(type, 'driver-changed-denies-retains-native', { deny: true }),
    make(type, 'hidden-driver-removed-native-retained', {
        driverHidden: true,
        hide: true,
    }),
    make(type, 'visible-driver-allows', { driverHidden: true }),
    make(type, 'hidden-section-next-title-resets', {
        hiddenSection: true,
        hide: true,
    }),
    make(type, 'hidden-section-without-reset', {
        hiddenSection: true,
        hide: true,
        noReset: true,
    }),
    make(type, 'list-retains-selected-option', { deny: true, list: true }),
    make(type, 'default-mode-equivalent', { defaultMode: true }),
    make(type, 'explicit-one-page-equivalent', { onePage: true }),
]);
