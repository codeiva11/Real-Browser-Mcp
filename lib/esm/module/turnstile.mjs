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
        // The CDP session died (page closed or target gone): drop the cached
        // session so the next call creates a fresh one instead of reusing a
        // dead one.
        try { page._noGestureCDPSession = undefined; } catch (_) {}
        return undefined;
    }
}

export const checkTurnstile = async ({ page }) => {
    try {
        if (!page || page.isClosed()) return false;
        // 1. Already-solved widgets leave a cf-turnstile-response field; their
        // parent box is where a re-click would land. Read via CDP (no gesture).
        const responseBoxes = await evaluateNoGesture(page, `(() => Array.from(document.querySelectorAll('[name="cf-turnstile-response"]')).map(el => { const p = el.parentElement; if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).filter(Boolean))()`);
        if (Array.isArray(responseBoxes) && responseBoxes.length > 0) {
            for (const box of responseBoxes) {
                try {
                    const x = box.x + Math.min(30, box.width / 4);
                    const y = box.y + box.height / 2;
                    await page.mouse.click(x, y);
                } catch (_err) { }
            }
            return true;
        }

        const isChallenge = await evaluateNoGesture(page, `(() => document.title.includes('Just a moment') || document.querySelector('#challenge-stage') !== null || document.querySelector('.cf-turnstile') !== null)()`);
        if (!isChallenge) return false;

        const coordinates = await evaluateNoGesture(page, `(() => {
            let coords = [];

            // 1. Find via known wrappers (most reliable, works regardless of size)
            document.querySelectorAll('.cf-turnstile, #challenge-stage').forEach(wrapper => {
                // Find the deepest div or iframe inside the wrapper
                const iframes = wrapper.querySelectorAll('iframe');
                if (iframes.length > 0) {
                    const rect = iframes[0].getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                    }
                } else {
                    // Find empty leaf divs inside challenge-stage
                    const emptyDivs = Array.from(wrapper.querySelectorAll('div')).filter(d => !d.querySelector('*'));
                    if (emptyDivs.length > 0) {
                        // Get the largest empty div (likely the widget container)
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

            // 2. Fallback: Heuristic search for widget-like elements (dynamic size)
            if (coords.length === 0) {
                document.querySelectorAll('div, iframe').forEach(item => {
                    try {
                        const rect = item.getBoundingClientRect();
                        const css = window.getComputedStyle(item);
                        // Turnstile widget usually has an aspect ratio around 4:1 to 5:1 (e.g. 300x65)
                        // We look for reasonable widget sizes rather than hardcoded 300px
                        const isWidgetSize = rect.width >= 150 && rect.width <= 400 && rect.height >= 40 && rect.height <= 100;

                        if (isWidgetSize) {
                            if (item.tagName === 'IFRAME') {
                                coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            } else if (!item.querySelector('*')) {
                                // Empty div with widget size
                                if (css.margin === "0px" && css.padding === "0px") {
                                    coords.unshift({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }); // High priority
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

        if (Array.isArray(coordinates)) {
            for (const item of coordinates) {
                try {
                    // Click slightly offset from left center (typical checkbox position)
                    let x = item.x + Math.min(30, item.w / 4);
                    let y = item.y + item.h / 2;
                    await page.mouse.click(x, y);
                } catch (_err) { }
            }
        }
        return true;
    } catch (_err) {
        return false;
    }
};
