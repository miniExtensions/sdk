# RatingField

`RatingField` has an additive controlled mode with complete configured icons,
empty state, range warning and explicit repair. It uses the existing `RatingInput`
engine for focus, keyboard, selection and clearing. Import its portable CSS.

```tsx
import { RatingField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/rating.css';

<RatingField
    mode="controlled"
    value={value}
    onChange={setValue}
    max={5}
    icon="heart"
    color="redBright"
    id="review-score"
    form="review"
    describedBy="score-help"
    disabled={readOnly}
    labels={{ empty: 'No rating', repair: 'Fix it' }}
/>;
```

The host owns committed values, current write authority and persistence. Change
proposals are immediate, including inline use; they never allocate a Save.
Optional `owner: { token, isCurrent() }` supplies a captured host capability.
The existing input also retires callbacks from replaced/unmounted presentation.
DOM IDs associate labels and forms; they do not grant authority.

Zero, null and out-of-range values are preserved on mount and refresh. A value
above the maximum is repaired only by an explicit enabled repair action.
Readonly null displays the localized empty label; grid mode supplies its summary
without a range input. Icon choices are star, heart, thumbsUp, flag and dot.
Palette codes retain native colors and unknown codes fall back to gray.

Labels are plain strings. `labels.outOfRange` may contain `{value}` and `{max}`;
the SDK owns warning markup and its unique description ID. `id`, `form`,
`describedBy`, `labelledBy` and `invalid` preserve host associations. The host
may own an outer label/help shell without injecting field UI.

Existing `RatingField({ binding, render?, iconInput? })` and `renderRatingField`
retain their numeric binding semantics and opt-in icon slots. Controlled mode
rejects binding, render and iconInput props rather than mixing authority models.
