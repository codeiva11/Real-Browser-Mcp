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
        const isSolved = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('[name="cf-turnstile-response"]'));
            return inputs.some((el) => el && el.value && el.value.length > 20);
        }).catch(() => false);
        if (isSolved) return true;

        // 2. Debounce: rate-limit clicks to at most once per 4s
        const now = Date.now();
        if (page._lastTurnstileClick && (now - page._lastTurnstileClick < 4000)) {
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
                if (box && box.width >= 100 && box.width <= 400 && box.height >= 40 && box.height <= 120) {
                    const cb = await cfFrame.$('input[type="checkbox"]').catch(() => null);
                    if (cb) {
                        const isChecked = await cb.isChecked().catch(() => false);
                        if (isChecked) return true;

                        const cbBox = await cb.boundingBox().catch(() => null);
                        let clickX = box.x + 28;
                        let clickY = box.y + box.height / 2;
                        if (cbBox && cbBox.width > 0) {
                            clickX = cbBox.x + Math.min(15, cbBox.width / 4);
                            clickY = cbBox.y + cbBox.height / 2;
                        }

                        await page.mouse.move(clickX, clickY, { steps: 5 }).catch(() => {});
                        await page.mouse.click(clickX, clickY).catch(() => {});
                        page._lastTurnstileClick = Date.now();
                        return true;
                    }
                    return false;
                }
            }
        }

        // 4. In-page search for standalone widgets (e.g., 2captcha or custom element wrappers)
        const widgetBox = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            for (const iframe of iframes) {
                const r = iframe.getBoundingClientRect();
                if (r.width >= 100 && r.width <= 400 && r.height >= 40 && r.height <= 120) {
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                }
            }
            const candidates = Array.from(document.querySelectorAll('.cf-turnstile, #challenge-stage div, [class*="turnstile"]'));
            for (const el of candidates) {
                const r = el.getBoundingClientRect();
                if (r.width >= 100 && r.width <= 400 && r.height >= 40 && r.height <= 120) {
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                }
            }
            return null;
        }).catch(() => null);

        if (widgetBox) {
            const clickX = widgetBox.x + Math.min(30, widgetBox.width / 4);
            const clickY = widgetBox.y + widgetBox.height / 2;
            await page.mouse.move(clickX, clickY, { steps: 5 }).catch(() => {});
            await page.mouse.click(clickX, clickY).catch(() => {});
            page._lastTurnstileClick = Date.now();
            return true;
        }

        // 5. Fallback for elements with name="cf-turnstile-response"
        const elements = await page.locator('[name="cf-turnstile-response"]').all().catch(() => []);
        for (const element of elements) {
            const box = await element.evaluate((el) => {
                const parent = el.parentElement;
                if (!parent) return null;
                const rect = parent.getBoundingClientRect();
                if (rect.width >= 100 && rect.width <= 400 && rect.height >= 40 && rect.height <= 120) {
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }
                return null;
            }).catch(() => null);

            if (box) {
                const clickX = box.x + Math.min(30, box.width / 4);
                const clickY = box.y + box.height / 2;
                await page.mouse.move(clickX, clickY, { steps: 5 }).catch(() => {});
                await page.mouse.click(clickX, clickY).catch(() => {});
                page._lastTurnstileClick = Date.now();
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
};



