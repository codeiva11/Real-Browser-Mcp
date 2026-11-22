// Playwright's page.evaluate() / locator.evaluate() / element.evaluate()
// run through Runtime.callFunctionOn with userGesture: true, which grants
// the page transient user activation (~5s). Any page script that opens a
// popup inside that window (e.g. bot-detector.rebrowser.net's popupBlocking
// test, which runs at window.onload) then sees a user-initiated popup and
// flags it. A raw CDP Runtime.evaluate does NOT pass userGesture, so it
// reads the DOM without activating the page. Every read-only DOM probe in
// this module uses it; the only real activation is the solver's own mouse
// click on a challenge widget, which is a genuine interaction.
export async function evaluateNoGesture(page, expression) {
    try {
        if (!page || page.isClosed()) return undefined;
        let session = page._noGestureCDPSession;
        if (!session) {
            session = await page.context().newCDPSession(page);
            page._noGestureCDPSession = session;
        }
        const result = await session.send('Runtime.evaluate', { expression, returnByValue: true });
        return result?.result?.value;
    } catch (_err) {
        try { page._noGestureCDPSession = undefined; } catch (_) {}
        return undefined;
    }
}

export const checkTurnstile = async ({ page }) => {
    try {
        if (!page || page.isClosed()) return false;

        // 1. Check if challenge/turnstile is already solved
        const isSolved = await evaluateNoGesture(page, `(() => {
            const inputs = Array.from(document.querySelectorAll('[name="cf-turnstile-response"]'));
            return inputs.some(el => el && el.value && el.value.length > 20);
        })()`);
        if (isSolved) return true;

        // 2. Debounce: rate-limit clicks to at most once per 3.5s so we don't spam and reset Cloudflare
        const now = Date.now();
        if (page._lastTurnstileClick && (now - page._lastTurnstileClick < 3500)) {
            return false;
        }

        // 3. Search in page.frames() for Cloudflare Turnstile / challenges frame
        const cfFrame = page.frames().find((f) => {
            const u = f.url();
            return u.includes('challenges.cloudflare.com') || u.includes('turnstile');
        });

        if (cfFrame) {
            const frameEl = await cfFrame.frameElement().catch(() => null);
            if (frameEl) {
                const box = await frameEl.boundingBox().catch(() => null);
                if (box && box.width >= 80 && box.width <= 500 && box.height >= 35 && box.height <= 160) {
                    const cb = await cfFrame.$('input[type="checkbox"]').catch(() => null);
                    if (cb) {
                        const isChecked = await cb.isChecked().catch(() => false);
                        if (isChecked) return true;
                    }

                    // Click inside the widget box on the left-center where the checkbox lives
                    let clickX = box.x + Math.min(30, box.width / 4);
                    let clickY = box.y + box.height / 2;
                    await page.mouse.move(clickX, clickY, { steps: 8 }).catch(() => {});
                    await page.mouse.click(clickX, clickY).catch(() => {});
                    page._lastTurnstileClick = Date.now();
                    return true;
                }
            }
        }

        // 4. Check if page has challenge in title or known elements
        const isChallenge = await evaluateNoGesture(page, `(() => {
            const title = (document.title || '').toLowerCase();
            return title.includes('just a moment') || title.includes('attention required') || document.querySelector('#challenge-stage') !== null || document.querySelector('.cf-turnstile') !== null || document.querySelector('[name="cf-turnstile-response"]') !== null;
        })()`);
        if (!isChallenge) return false;

        // 5. In-page search via DOM coordinates (using evaluateNoGesture)
        const coordinates = await evaluateNoGesture(page, `(() => {
            let coords = [];

            // Find via known wrappers
            document.querySelectorAll('.cf-turnstile, #challenge-stage').forEach(wrapper => {
                const iframes = wrapper.querySelectorAll('iframe');
                if (iframes.length > 0) {
                    const rect = iframes[0].getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                    }
                } else {
                    const emptyDivs = Array.from(wrapper.querySelectorAll('div')).filter(d => !d.querySelector('*'));
                    if (emptyDivs.length > 0) {
                        const target = emptyDivs.reduce((prev, current) => {
                            const pRect = prev.getBoundingClientRect();
                            const cRect = current.getBoundingClientRect();
                            return (pRect.width * pRect.height > cRect.width * cRect.height) ? prev : current;
                        });
                        const rect = target.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 20) {
                            coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                        }
                    }
                }
            });

            // Fallback: search for cf-turnstile-response parent
            if (coords.length === 0) {
                document.querySelectorAll('[name="cf-turnstile-response"]').forEach(el => {
                    const p = el.parentElement;
                    if (p) {
                        const r = p.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            coords.push({ x: r.x, y: r.y, w: r.width, h: r.height });
                        }
                    }
                });
            }

            // Fallback: Heuristic search for widget-like elements (dynamic size)
            if (coords.length === 0) {
                document.querySelectorAll('div, iframe').forEach(item => {
                    try {
                        const rect = item.getBoundingClientRect();
                        const css = window.getComputedStyle(item);
                        const isWidgetSize = rect.width >= 120 && rect.width <= 400 && rect.height >= 40 && rect.height <= 120;

                        if (isWidgetSize) {
                            if (item.tagName === 'IFRAME') {
                                coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            } else if (!item.querySelector('*')) {
                                if (css.margin === "0px" && css.padding === "0px") {
                                    coords.unshift({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                                } else {
                                    coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                                }
                            }
                        }
                    } catch (_err) { }
                });
            }
            return coords;
        })()`);

        if (Array.isArray(coordinates) && coordinates.length > 0) {
            for (const item of coordinates) {
                try {
                    let x = item.x + Math.min(30, item.w / 4);
                    let y = item.y + item.h / 2;
                    await page.mouse.move(x, y, { steps: 8 }).catch(() => {});
                    await page.mouse.click(x, y).catch(() => {});
                    page._lastTurnstileClick = Date.now();
                } catch (_err) { }
            }
            return true;
        }

        return false;
    } catch (_err) {
        return false;
    }
};



