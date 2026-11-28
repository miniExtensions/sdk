import assert from 'node:assert/strict';

const titles = ['Bay A', 'Warehouse booking B', 'Depot C'];
const cardLabels = titles.map((title) => `Record ${title}`);
const choiceDialog = 'dialog.mx-sdk-portal-map-choices[open]';

async function readPortalMapColocationLayout(page) {
    return page.evaluate((cardLabels) => {
        const openOwner = (button) =>
            button
                ?.closest('.mx-sdk-portal-map-card')
                ?.getAttribute('aria-label') ?? null;
        const ownersAt = ({ x, y }) => {
            const elements = document.elementsFromPoint(x, y);
            const buttons = [
                ...new Set(
                    elements
                        .map((element) =>
                            element.closest('.mx-sdk-portal-map-open')
                        )
                        .filter(Boolean)
                ),
            ];
            return {
                openLabels: buttons.map((button) =>
                    button.getAttribute('aria-label')
                ),
                openOwners: buttons.map(openOwner),
                cardLabels: [
                    ...new Set(
                        elements
                            .map((element) =>
                                element
                                    .closest('.mx-sdk-portal-map-card')
                                    ?.getAttribute('aria-label')
                            )
                            .filter(Boolean)
                    ),
                ],
            };
        };
        const openButtons = [
            ...document.querySelectorAll('.mx-sdk-portal-map-open'),
        ];
        const opens = cardLabels.map((cardLabel) => {
            const button = openButtons.find(
                (open) => openOwner(open) === cardLabel
            );
            if (!button)
                throw Error('Missing packed Map trigger for ' + cardLabel);
            const { x, y, top, right, bottom, left, width, height } =
                button.getBoundingClientRect();
            return {
                label: button.getAttribute('aria-label'),
                cardLabel,
                x,
                y,
                top,
                right,
                bottom,
                left,
                width,
                height,
            };
        });
        window.portalMapColocationBayTrigger = openButtons.find(
            (button) => openOwner(button) === cardLabels[0]
        );
        const [bay, warehouse, depot] = opens;
        const sharedBounds = {
            left: Math.max(bay.left, warehouse.left),
            right: Math.min(bay.right, warehouse.right),
            top: Math.max(bay.top, warehouse.top),
            bottom: Math.min(bay.bottom, warehouse.bottom),
        };
        const centerOf = ({ left, right, top, bottom }) => ({
            x: Math.round((left + right) / 2),
            y: Math.round((top + bottom) / 2),
        });
        const baySamples = [0.25, 0.5, 0.75].flatMap((column) =>
            [0.25, 0.5, 0.75].map((row) => {
                const point = {
                    x: Math.round(bay.left + bay.width * column),
                    y: Math.round(bay.top + bay.height * row),
                };
                return { point, ...ownersAt(point) };
            })
        );
        const sharedPoint = centerOf(sharedBounds);
        const depotPoint = centerOf(depot);
        const events = [];
        for (const type of ['pointerdown', 'pointerup', 'click']) {
            document.addEventListener(
                type,
                (event) => {
                    const button = event.target.closest?.(
                        '.mx-sdk-portal-map-open, .mx-sdk-portal-map-choices button'
                    );
                    events.push({
                        type,
                        trusted: event.isTrusted,
                        pointerType: event.pointerType ?? null,
                        detail: event.detail ?? null,
                        label:
                            button?.getAttribute('aria-label') ??
                            button?.textContent.trim() ??
                            null,
                        cardLabel: openOwner(button),
                        choice: Boolean(
                            button?.closest('.mx-sdk-portal-map-choices')
                        ),
                    });
                },
                true
            );
        }
        window.portalMapColocationEvents = events;
        const host = window.portalMapProof.snapshot();
        return {
            viewport: {
                width: innerWidth,
                height: innerHeight,
                touchPoints: navigator.maxTouchPoints,
                coarsePointer: matchMedia('(pointer: coarse)').matches,
            },
            opens,
            sharedBounds,
            shared: { point: sharedPoint, ...ownersAt(sharedPoint) },
            depot: { point: depotPoint, ...ownersAt(depotPoint) },
            baySamples,
            providerPositions: host.rows[0]?.visible ?? [],
            callbacks: host.opens,
            submits: host.submits,
        };
    }, cardLabels);
}

async function readColocationInput(page) {
    return page.evaluate((choiceDialog) => {
        const host = window.portalMapProof.snapshot();
        return {
            events: window.portalMapColocationEvents.splice(0),
            callbacks: host.opens,
            submits: host.submits,
            openDialogs: document.querySelectorAll(choiceDialog).length,
        };
    }, choiceDialog);
}

async function tapPortalMap(page, name, point) {
    await page.touchscreen.tap(point.x, point.y);
    return { name, point, ...(await readColocationInput(page)) };
}

async function readTouchChoices(page) {
    const dialog = page.locator(choiceDialog);
    await dialog.waitFor({ state: 'visible' });
    const accessibleTree = await dialog.ariaSnapshot();
    const options = [];
    for (const name of titles.slice(0, 2)) {
        const option = dialog.getByRole('button', { name, exact: true });
        assert.equal(
            await option.count(),
            1,
            `Expected one choice named "${name}". Observed:\n${accessibleTree}`
        );
        const box = await option.boundingBox();
        assert(box, 'Visible choice must have a browser rectangle');
        const point = {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
        };
        options.push({
            name,
            box,
            point,
            visibleTitle: (await option.innerText()).trim(),
            exposed: await option.evaluate(
                (button, { x, y }) =>
                    document.elementFromPoint(x, y)?.closest('button') ===
                    button,
                point
            ),
        });
    }
    return {
        options,
        accessibleTree,
        ...(await dialog.evaluate((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            const visual = visualViewport;
            const host = window.portalMapProof.snapshot();
            return {
                nativeModal:
                    element instanceof HTMLDialogElement &&
                    element.matches(':modal'),
                box: { x, y, width, height },
                viewport: {
                    width: innerWidth,
                    height: innerHeight,
                    visualWidth: visual?.width ?? null,
                    visualHeight: visual?.height ?? null,
                    coarsePointer: matchMedia('(pointer: coarse)').matches,
                },
                callbacks: host.opens,
                submits: host.submits,
            };
        })),
    };
}

async function readFocusedMarker(page, point) {
    return page.evaluate(({ x, y }) => {
        const owner = (node) =>
            node
                ?.closest('.mx-sdk-portal-map-card')
                ?.getAttribute('aria-label') ?? null;
        const active = document.activeElement;
        return {
            owner: owner(active),
            focusVisible: active?.matches(
                '.mx-sdk-portal-map-open:focus-visible'
            ),
            hitOwner: owner(document.elementFromPoint(x, y)),
        };
    }, point);
}

async function focusPaint(page, idle, focused) {
    return page.evaluate(
        async (frames) => {
            const accentPixels = [];
            for (const png of frames) {
                const image = await createImageBitmap(
                    new Blob(
                        [
                            Uint8Array.from(atob(png), (value) =>
                                value.charCodeAt(0)
                            ),
                        ],
                        { type: 'image/png' }
                    )
                );
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const context = canvas.getContext('2d');
                    context.drawImage(image, 0, 0);
                    const { data } = context.getImageData(
                        0,
                        0,
                        image.width,
                        image.height
                    );
                    let count = 0;
                    for (let offset = 0; offset < data.length; offset += 4)
                        if (
                            data[offset] === 37 &&
                            data[offset + 1] === 99 &&
                            data[offset + 2] === 235 &&
                            data[offset + 3] === 255
                        )
                            count++;
                    accentPixels.push(count);
                } finally {
                    image.close();
                }
            }
            return { idle: accentPixels[0], focused: accentPixels[1] };
        },
        [idle.toString('base64'), focused.toString('base64')]
    );
}

export async function capturePortalMapColocationPointerCandidate(
    page,
    { captureFocus, observation }
) {
    const before = await readPortalMapColocationLayout(page);
    observation.before = before;
    assert.equal(before.viewport.touchPoints, 0);
    assert.equal(before.shared.openOwners[0], cardLabels[1]);
    assert.deepEqual(before.callbacks, []);
    const [bayBox, warehouseBox] = before.opens;
    // Leave room for the two-pixel accent outline and its two-pixel offset.
    const clip = {
        x: Math.floor(bayBox.left) - 6,
        y: Math.floor(bayBox.top) - 6,
        width: Math.ceil(bayBox.width) + 12,
        height: Math.ceil(bayBox.height) + 12,
    };
    const idle = await page.screenshot({ clip, scale: 'css' });
    await page.keyboard.press('Tab');
    observation.focused = await readFocusedMarker(page, before.shared.point);
    assert.deepEqual(observation.focused, {
        owner: cardLabels[0],
        focusVisible: true,
        hitOwner: cardLabels[1],
    });
    const focused = await page.screenshot({ clip, scale: 'css' });
    observation.focusPaint = await focusPaint(page, idle, focused);
    assert.equal(observation.focusPaint.idle, 0);
    assert(
        observation.focusPaint.focused > 0,
        'Bay A must paint its visible focus outline'
    );
    await captureFocus();
    const bay = { root: 'first', record: 'bay-a' };
    const warehouse = { root: 'first', record: 'warehouse-booking-b' };

    await page.keyboard.press('Enter');
    observation.enter = await readColocationInput(page);
    assert.deepEqual(observation.enter.callbacks, [bay]);
    assert.deepEqual(
        observation.enter.events.map(
            ({ type, cardLabel, detail, trusted }) => ({
                type,
                cardLabel,
                detail,
                trusted,
            })
        ),
        [{ type: 'click', cardLabel: cardLabels[0], detail: 0, trusted: true }]
    );
    assert.deepEqual(
        await readFocusedMarker(page, before.shared.point),
        observation.focused
    );
    const assertMouseGesture = (gesture, callbacks) => {
        assert.deepEqual(gesture.callbacks, callbacks);
        assert.deepEqual(
            gesture.events.map(({ type }) => type),
            ['pointerdown', 'pointerup', 'click']
        );
        assert(
            gesture.events.every(
                ({ trusted, pointerType, cardLabel }) =>
                    trusted &&
                    pointerType === 'mouse' &&
                    cardLabel === cardLabels[1]
            )
        );
        assert.equal(gesture.events.at(-1).detail, 1);
        assert.equal(gesture.submits, 0);
        assert.equal(gesture.openDialogs, 0);
    };

    const { x, y } = before.shared.point;
    await page.mouse.click(x, y);
    observation.sharedMouse = await readColocationInput(page);
    assertMouseGesture(observation.sharedMouse, [bay, warehouse]);

    // Focus the wider card with real keys. A unique outer point exposes a
    // regression that disables the entire keyboard-focused card's button.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    observation.uniqueWarehousePoint = {
        x: Math.round((warehouseBox.left + bayBox.left) / 2),
        y,
    };
    assert(observation.uniqueWarehousePoint.x < bayBox.left);
    observation.focusedWarehouse = await readFocusedMarker(
        page,
        observation.uniqueWarehousePoint
    );
    assert.deepEqual(observation.focusedWarehouse, {
        owner: cardLabels[1],
        focusVisible: true,
        hitOwner: cardLabels[1],
    });
    await page.mouse.click(observation.uniqueWarehousePoint.x, y);
    observation.uniqueMouse = await readColocationInput(page);
    assertMouseGesture(observation.uniqueMouse, [bay, warehouse, warehouse]);
    assert.equal(observation.enter.submits, 0);
    assert.equal(observation.enter.openDialogs, 0);
}

export async function capturePortalMapColocationTouchCandidate(
    page,
    { onDialog, onKeyboardFocus, observation }
) {
    const before = await readPortalMapColocationLayout(page);
    const dialogs = [];
    const taps = [];
    const keyboard = [];
    Object.assign(observation, { before, keyboard, dialogs, taps });
    assert.equal(before.shared.openOwners[0], cardLabels[1]);
    for (const [index, label] of cardLabels.entries()) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(({ x, y }) => {
            const owner = (button) =>
                button
                    ?.closest('.mx-sdk-portal-map-card')
                    ?.getAttribute('aria-label') ?? null;
            const focused = document.activeElement;
            const host = window.portalMapProof.snapshot();
            return {
                focused: owner(focused),
                focusVisible: focused?.matches(
                    '.mx-sdk-portal-map-open:focus-visible'
                ),
                top: owner(document.elementFromPoint(x, y)),
                callbacks: host.opens,
                submits: host.submits,
            };
        }, before.shared.point);
        keyboard.push(state);
        assert.equal(state.focused, label);
        assert.equal(state.focusVisible, true);
        assert.equal(state.top, cardLabels[1]);
        assert.deepEqual(state.callbacks, []);
        assert.equal(state.submits, 0);
        if (index === 0) await onKeyboardFocus();
    }
    await page.evaluate(() => document.activeElement.blur());
    const dialog = page.locator(choiceDialog);
    for (const [index, record] of ['bay-a', 'warehouse-booking-b'].entries()) {
        taps.push(
            await tapPortalMap(
                page,
                `shared-for-${record}`,
                before.shared.point
            )
        );
        const current = await readTouchChoices(page);
        dialogs.push(current);
        await onDialog(record);
        taps.push(
            await tapPortalMap(
                page,
                `choose-${record}`,
                current.options[index].point
            )
        );
        await dialog.waitFor({ state: 'hidden' });
    }
    taps.push(
        await tapPortalMap(page, 'independent-depot', before.depot.point)
    );
    taps.push(
        await tapPortalMap(
            page,
            'shared-before-warehouse-removal',
            before.shared.point
        )
    );
    dialogs.push(await readTouchChoices(page));
    await onDialog('warehouse-removal');
    await page.evaluate(() => {
        window.portalMapProof.removeColocatedWarehouse();
        window.portalMapGoogleBoundary.draw();
    });
    await dialog.waitFor({ state: 'hidden' });
    await page
        .getByRole('group', { name: cardLabels[1], exact: true })
        .waitFor({ state: 'detached' });
    const remaining = await page.evaluate(
        ({ cardLabels, choiceDialog }) => {
            const buttons = [
                ...document.querySelectorAll('.mx-sdk-portal-map-open'),
            ];
            const owner = (button) =>
                button
                    .closest('.mx-sdk-portal-map-card')
                    ?.getAttribute('aria-label');
            const [bay, depot] = [cardLabels[0], cardLabels[2]].map((name) =>
                buttons.find((button) => owner(button) === name)
            );
            const toBox = (button) => {
                const { x, y, width, height } = button.getBoundingClientRect();
                return { x, y, width, height };
            };
            const bayBox = toBox(bay);
            const bayPoint = {
                x: Math.round(bayBox.x + bayBox.width / 2),
                y: Math.round(bayBox.y + bayBox.height / 2),
            };
            const host = window.portalMapProof.snapshot();
            return {
                bayBox,
                bayPoint,
                bayDirectHit:
                    document
                        .elementFromPoint(bayPoint.x, bayPoint.y)
                        ?.closest('button') === bay,
                originalBayTrigger:
                    bay === window.portalMapColocationBayTrigger,
                depotBox: toBox(depot),
                warehouseTriggerCount: buttons.filter(
                    (button) => owner(button) === cardLabels[1]
                ).length,
                rows: host.rows[0].visible.map(({ key }) => key),
                callbacks: host.opens,
                submits: host.submits,
                openDialogs: document.querySelectorAll(choiceDialog).length,
                events: window.portalMapColocationEvents.splice(0),
            };
        },
        { cardLabels, choiceDialog }
    );
    observation.afterRemovingWarehouse = remaining;
    taps.push(await tapPortalMap(page, 'remaining-bay', remaining.bayPoint));
}

export function assertPortalMapColocationTouchCandidate({
    before,
    dialogs,
    taps,
    afterRemovingWarehouse,
}) {
    assert.equal(before.viewport.width, 390);
    assert(before.viewport.touchPoints > 0 && before.viewport.coarsePointer);
    assert.deepEqual(
        before.opens.map(({ label, cardLabel }) => [label, cardLabel]),
        cardLabels.map((cardLabel) => ['Open', cardLabel])
    );
    assert.deepEqual(
        [...before.shared.openOwners].sort(),
        cardLabels.slice(0, 2).sort()
    );
    assert.deepEqual(before.shared.openLabels, ['Open', 'Open']);
    assert.deepEqual(before.depot.openOwners, [cardLabels[2]]);
    assert.deepEqual(before.callbacks, []);
    assert.equal(before.submits, 0);
    const bay = { root: 'first', record: 'bay-a' };
    const warehouse = { root: 'first', record: 'warehouse-booking-b' };
    const depot = { root: 'first', record: 'depot-c' };
    assert.deepEqual(
        taps.map(({ callbacks }) => callbacks),
        [
            [],
            [bay],
            [bay],
            [bay, warehouse],
            [bay, warehouse, depot],
            [bay, warehouse, depot],
            [bay, warehouse, depot, bay],
        ]
    );
    assert.deepEqual(
        taps.map(({ openDialogs }) => openDialogs),
        [1, 0, 1, 0, 0, 1, 0]
    );
    assert.deepEqual(
        dialogs.map(({ callbacks }) => callbacks),
        [[], [bay], [bay, warehouse, depot]]
    );
    for (const dialog of dialogs) {
        assert(dialog.nativeModal);
        assert(dialog.accessibleTree.startsWith('- dialog'));
        assert.equal(dialog.submits, 0);
        assert.equal(dialog.viewport.width, 390);
        assert(dialog.viewport.coarsePointer);
        const { x, y, width, height } = dialog.box;
        assert(x >= 0 && y >= 0 && width > 0 && height > 0);
        assert(x + width <= dialog.viewport.width);
        assert(y + height <= dialog.viewport.height);
        assert.deepEqual(
            dialog.options.map(({ name, visibleTitle }) => [
                name,
                visibleTitle,
            ]),
            titles.slice(0, 2).map((title) => [title, title])
        );
        assert(
            dialog.options.every(
                ({ exposed, box }) =>
                    exposed &&
                    box.x >= x &&
                    box.y >= y &&
                    box.x + box.width <= x + width &&
                    box.y + box.height <= y + height
            )
        );
        assert(!dialog.accessibleTree.includes(titles[2]));
    }
    const sharedOwner = before.shared.openOwners[0];
    const expectedTrustedTargets = [
        ['Open', sharedOwner],
        [titles[0], null],
        ['Open', sharedOwner],
        [titles[1], null],
        ['Open', cardLabels[2]],
        ['Open', sharedOwner],
        ['Open', cardLabels[0]],
    ];
    for (const [index, tap] of taps.entries()) {
        assert.equal(tap.submits, 0);
        const choosing = index === 1 || index === 3;
        const trustedEvents = tap.events.filter(({ trusted }) => trusted);
        const forwardedEvents = tap.events.filter(({ trusted }) => !trusted);
        assert.deepEqual(
            trustedEvents.map(({ type }) => type),
            ['pointerdown', 'pointerup', 'click']
        );
        assert(trustedEvents.every(({ choice }) => choice === choosing));
        assert.deepEqual(
            trustedEvents.map(({ label, cardLabel }) => [label, cardLabel]),
            Array(3).fill(expectedTrustedTargets[index])
        );
        assert.deepEqual(
            forwardedEvents.map(
                ({ type, label, cardLabel, choice, detail }) => ({
                    type,
                    label,
                    cardLabel,
                    choice,
                    detail,
                })
            ),
            choosing
                ? [
                      {
                          type: 'click',
                          label: 'Open',
                          cardLabel: cardLabels[index === 1 ? 0 : 1],
                          choice: false,
                          detail: 0,
                      },
                  ]
                : []
        );
        assert(
            trustedEvents
                .slice(0, 2)
                .every(({ pointerType }) => pointerType === 'touch')
        );
    }
    const originalBox = ({ x, y, width, height }) => ({ x, y, width, height });
    assert.deepEqual(afterRemovingWarehouse.rows, ['bay-a', 'depot-c']);
    assert.deepEqual(afterRemovingWarehouse.callbacks, [bay, warehouse, depot]);
    assert.deepEqual(afterRemovingWarehouse.events, []);
    assert.equal(afterRemovingWarehouse.submits, 0);
    assert.equal(afterRemovingWarehouse.openDialogs, 0);
    assert.equal(afterRemovingWarehouse.warehouseTriggerCount, 0);
    assert(
        afterRemovingWarehouse.bayDirectHit &&
            afterRemovingWarehouse.originalBayTrigger
    );
    assert.deepEqual(
        afterRemovingWarehouse.bayBox,
        originalBox(before.opens[0])
    );
    assert.deepEqual(
        afterRemovingWarehouse.depotBox,
        originalBox(before.opens[2])
    );
}
