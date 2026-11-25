import assert from 'node:assert/strict';

export async function checkNativeTopbar(browser, origin) {
    const page = await browser.newPage();
    const measurements = [];
    try {
        await page.goto(origin);
        await page
            .getByRole('heading', { name: '<Customer Portal>' })
            .waitFor();
        for (const width of [375, 639, 640, 1023, 1024, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            for (const title of [
                'Projects',
                'Existing Projects and their complete details across all accounts in this Portal',
            ]) {
                for (const actions of [false, true]) {
                    await page.evaluate(
                        ({ title, actions }) =>
                            window.configure({
                                header: {
                                    layout: 'topbar',
                                    topbarLayout: 'native',
                                    title,
                                    actionsPlacement: 'layout',
                                    menuInteraction: 'menu',
                                },
                                user: {
                                    name: 'Visitor',
                                    settingsEnabled: actions,
                                    logoutEnabled: actions,
                                    presentation: 'icon',
                                },
                                searchAgainEnabled: actions,
                            }),
                        { title, actions }
                    );
                    await page.waitForFunction(
                        ({ title, actions }) =>
                            window.fixtureCommittedSnapshot?.header.title ===
                                title &&
                            window.fixtureCommittedSnapshot
                                .searchAgainEnabled === actions,
                        { title, actions }
                    );
                    const shell = page.locator(
                        '.mx-sdk-portal-shell--native-topbar'
                    );
                    const placement = await shell.evaluate((node) => {
                        const top = node.getBoundingClientRect().top;
                        const header = node.querySelector(':scope > header');
                        const content = node.querySelector(':scope > main');
                        const navigation = header.querySelector(
                            '.mx-sdk-portal-navigation-wrap'
                        );
                        const nav = navigation.getBoundingClientRect();
                        return {
                            headerHeight: header.getBoundingClientRect().height,
                            bodyTop:
                                content.getBoundingClientRect().top -
                                top +
                                parseFloat(
                                    getComputedStyle(content).paddingTop
                                ),
                            navigationTop: nav.top - top,
                            navigationBottom: nav.bottom - top,
                            navigationWidth: nav.width,
                            documentWidth: document.documentElement.scrollWidth,
                        };
                    });
                    assert.equal(placement.headerHeight, 64);
                    assert.equal(placement.bodyTop, 64);
                    assert.equal(placement.documentWidth, width);
                    if (width < 640) assert.equal(placement.navigationWidth, 0);
                    else {
                        assert(placement.navigationWidth > 0);
                        assert(
                            placement.navigationTop >= 0 &&
                                placement.navigationBottom <= 64
                        );
                    }
                    measurements.push({ width, title, actions, ...placement });
                }
            }
            const header = page.locator(
                '.mx-sdk-portal-shell--native-topbar > header'
            );
            if (width < 640) {
                const opener = header.getByRole('button', {
                    name: 'Open navigation',
                    exact: true,
                });
                await opener.focus();
                await opener.press('Enter');
                const drawer = header.getByRole('dialog');
                await drawer
                    .getByRole('button', { name: 'Search again', exact: true })
                    .waitFor();
                await page.keyboard.press('Escape');
                await drawer.waitFor({ state: 'hidden' });
                assert(
                    await opener.evaluate(
                        (node) => node === document.activeElement
                    )
                );
            } else {
                const summary = header
                    .locator('nav summary')
                    .filter({ hasText: 'Orders' })
                    .first();
                // The desktop CSS breakpoint can settle before the React drawer state.
                await summary.waitFor({ state: 'visible' });
                await summary.focus();
                assert(
                    await summary.evaluate(
                        (node) => node === document.activeElement
                    )
                );
                await page.keyboard.press('ArrowDown');
                await page
                    .waitForFunction(
                        () => {
                            const item = document.activeElement;
                            if (
                                !item?.closest('details[open]') ||
                                item.tagName === 'SUMMARY'
                            )
                                return false;
                            const box = item.getBoundingClientRect();
                            return item.contains(
                                document.elementFromPoint(
                                    box.x + box.width / 2,
                                    box.y + box.height / 2
                                )
                            );
                        },
                        undefined,
                        { timeout: 5000 }
                    )
                    .catch(async (cause) => {
                        const focus = await summary.evaluate((node) => {
                            const active = document.activeElement;
                            const box = active.getBoundingClientRect();
                            const hit = document.elementFromPoint(
                                box.x + box.width / 2,
                                box.y + box.height / 2
                            );
                            const nav = node.closest('nav');
                            const menu = node.parentElement.querySelector('ul');
                            return {
                                active: [
                                    active.tagName,
                                    active.textContent.slice(0, 80),
                                ],
                                box: box.toJSON(),
                                hit: hit && [hit.tagName, hit.className],
                                open: node.parentElement.open,
                                nav: nav.getBoundingClientRect().toJSON(),
                                scroll: [nav.scrollLeft, nav.scrollTop],
                                menu: menu?.getBoundingClientRect().toJSON(),
                                offsetParent: menu?.offsetParent?.className,
                            };
                        });
                        throw new Error(
                            `Orders submenu is unreachable at ${width}px: ${JSON.stringify(focus)}`,
                            { cause }
                        );
                    });
                await page.keyboard.press('Escape');
                assert(
                    await summary.evaluate(
                        (node) => node === document.activeElement
                    )
                );
                await header
                    .getByRole('button', { name: 'Search again', exact: true })
                    .click();
                assert.equal(
                    await page.evaluate(
                        () => window.proof.intents.at(-1)?.type
                    ),
                    'search-again'
                );
            }
        }
        measurements.push(...(await checkDesktopTitleVariants(page)));
        return measurements;
    } finally {
        await page.close();
    }
}

async function checkDesktopTitleVariants(page) {
    const measurements = [];
    const shell = page.locator('.mx-sdk-portal-shell--native-desktop-topbar');
    const header = shell.locator(':scope > header');
    const navigation = header.locator(
        ':scope > .mx-sdk-portal-navigation-wrap'
    );
    const opener = header.getByRole('button', {
        name: 'Open navigation',
        exact: true,
    });
    const summary = navigation
        .locator('summary')
        .filter({ hasText: /^Orders$/ });
    const view = navigation.getByRole('button', {
        name: 'Open orders',
        exact: true,
    });
    const geometry = () =>
        shell.evaluate((node) => {
            const header = node
                .querySelector(':scope > header')
                .getBoundingClientRect();
            const table = node
                .querySelector('nav summary')
                .getBoundingClientRect();
            const workspace = node.querySelector('main');
            return {
                headerHeight: header.height,
                insideHeader:
                    table.top >= header.top && table.bottom <= header.bottom,
                workspaceTop:
                    workspace.getBoundingClientRect().top +
                    parseFloat(getComputedStyle(workspace).paddingTop),
                firstRowTop: workspace
                    .querySelector('p')
                    .getBoundingClientRect().top,
                documentWidth: document.documentElement.scrollWidth,
            };
        });
    for (const profile of ['rich', 'editable']) {
        await page.evaluate((profile) => {
            const rich = profile === 'rich';
            window.configure({
                header: {
                    layout: 'topbar',
                    topbarLayout: 'native-desktop',
                    title: rich ? '' : 'Editable Portal',
                    ...(rich
                        ? { titleHtml: '<strong>Rich Portal</strong>' }
                        : {}),
                    showBrandInNavigation: true,
                    actionsPlacement: 'layout',
                    menuInteraction: 'menu',
                },
                settings: rich
                    ? undefined
                    : {
                          title: 'Edit title',
                          items: [
                              {
                                  itemId: 'orders',
                                  label: 'Edit Orders',
                                  includeViews: false,
                              },
                          ],
                      },
            });
        }, profile);
        await shell.waitFor();
        await (
            profile === 'rich'
                ? header
                      .locator('.mx-sdk-portal-title-html strong')
                      .filter({ hasText: /^Rich Portal$/ })
                : header.getByRole('heading', { name: 'Editable Portal' })
        ).waitFor();
        const ownedNavigation = await navigation.elementHandle();
        assert(ownedNavigation);
        try {
            for (const width of [375, 639, 640, 1200, 1280]) {
                const height = width === 1280 ? 800 : 813;
                await page.setViewportSize({ width, height });
                if (width < 640) {
                    await opener.waitFor();
                    assert(!(await navigation.isVisible()));
                    await opener.press('Enter');
                    const drawer = header.getByRole('dialog', {
                        name: 'Portal navigation',
                    });
                    await drawer.waitFor();
                    assert(
                        await drawer
                            .getByText(
                                profile === 'rich'
                                    ? 'Rich Portal'
                                    : 'Editable Portal',
                                { exact: true }
                            )
                            .isVisible()
                    );
                    await page.keyboard.press('Escape');
                    await drawer.waitFor({ state: 'hidden' });
                    assert(
                        await opener.evaluate(
                            (node) => node === document.activeElement
                        )
                    );
                } else {
                    await opener.waitFor({ state: 'hidden' });
                    await summary.waitFor();
                    const rest = await geometry();
                    assert.equal(rest.headerHeight, 64);
                    assert.equal(rest.workspaceTop, 64);
                    assert(rest.insideHeader);
                    assert.equal(rest.documentWidth, width);
                    await summary.hover();
                    await view.waitFor();
                    assert.deepEqual(await geometry(), rest);
                    await page.mouse.move(width - 1, height - 1);
                    await view.waitFor({ state: 'hidden' });
                    assert.deepEqual(await geometry(), rest);
                    await summary.focus();
                    await page.keyboard.press('ArrowDown');
                    await view.waitFor();
                    assert(
                        await view.evaluate((node) => {
                            const bounds = node.getBoundingClientRect();
                            return (
                                node === document.activeElement &&
                                node.contains(
                                    document.elementFromPoint(
                                        bounds.x + bounds.width / 2,
                                        bounds.y + bounds.height / 2
                                    )
                                )
                            );
                        })
                    );
                    assert.deepEqual(await geometry(), rest);
                    await page.keyboard.press('Escape');
                    await view.waitFor({ state: 'hidden' });
                    assert(
                        await summary.evaluate(
                            (node) => node === document.activeElement
                        )
                    );
                    assert.deepEqual(await geometry(), rest);
                    if (profile === 'editable') {
                        const before = await page.evaluate(
                            () => window.proof.settings.length
                        );
                        await header
                            .getByRole('button', {
                                name: 'Edit title',
                                exact: true,
                            })
                            .press('Enter');
                        await header
                            .getByRole('button', {
                                name: 'Edit Orders',
                                exact: true,
                            })
                            .press('Enter');
                        assert.deepEqual(
                            await page.evaluate(
                                (before) =>
                                    window.proof.settings
                                        .slice(before)
                                        .map(({ target }) => target),
                                before
                            ),
                            [
                                { type: 'title' },
                                { type: 'item', itemId: 'orders' },
                            ]
                        );
                    }
                    measurements.push({ width, height, profile, ...rest });
                }
                assert(
                    await ownedNavigation.evaluate((node) => node.isConnected)
                );
            }
        } finally {
            await ownedNavigation.dispose();
        }
    }
    return measurements;
}
