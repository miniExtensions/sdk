# CountField

Import `CountField` from `@miniextensions/sdk/react`. It supports two explicit ownership contracts.

The existing binding API is unchanged:

```tsx
import { CountField, type CountFieldProps } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/number.css';

<CountField binding={countBinding} />;
```

`CountFieldProps` remains the binding contract, including its custom `render` override. It observes visibility, retirement, pending state, feedback and Count metadata. Only finite native numbers with valid Count metadata display in its disabled Number control. Zero remains zero; null, missing, invalid metadata and nonnumeric values remain blank. It never reads a scalar or invokes a setter. `renderCountField` and `CountFieldOptions` retain their existing renderer-slot behavior.

Native callers and controlled applications can supply converted display text directly:

```tsx
import {
    CountField,
    type ControlledCountFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

<CountField value="0" language="en" />;
```

`ControlledCountFieldProps` accepts `value: string | null | undefined`, `language`, and optional `textSize`, `layout` and `className`. The host retains source conversion and masking policy: native numeric-type errors, invalid metadata, special numeric values and error text must be converted with the existing source converter before rendering. An empty string, null or undefined uses the complete localized empty presentation. A supplied `"0"` displays zero. Supplied error text stays literal with the complete readonly component's safe automatic links.

The controlled mode reuses `CompleteReadOnlyTextField`. It has no binding, render override, setter, network request, Save, provider action or count calculation. Keep title, help, error and form associations in the surrounding field shell, such as `CompleteFormFieldPresentation` with a non-labelable association. Preview and readonly surfaces use the same controlled leaf. Do not pass both ownership contracts to one instance.

Both modes are public ESM/CJS and declaration exports for React 18/19. Each uses its existing public stylesheet; no separate Count stylesheet is required.
