import { checkTurnstile } from './turnstile.mjs';

export async function pageController({ browser, page, proxy, turnstile }) {
    if (page._pageControllerApplied) return page;
    page._pageControllerApplied = true;

    let solveStatus = turnstile;

    page.on('close', () => {
        solveStatus = false;
    });

    async function turnstileSolver() {
        while (solveStatus) {
            await checkTurnstile({ page }).catch(() => { });
            // Unref the idle timer so this background loop never keeps the
            // Node process alive on its own.
            await new Promise(r => {
                const t = setTimeout(r, 1000);
                if (typeof t.unref === 'function') t.unref();
            });
        }
    }

    if (solveStatus) {
        turnstileSolver().catch(() => { });
    }

    const context = page.context();
    if (!context._popupBlockerApplied) {
        context._popupBlockerApplied = true;
        context.on('page', async (newPage) => {
            try {
                const opener = await newPage.opener();
                if (!opener) return;

                // FIX: Wait for the page to navigate away from about:blank before
                // judging its URL. Firing immediately catches every legitimate popup
                // (OAuth, payment windows, new tabs) while they are still blank.
                // We wait up to 2s for a real URL to appear.
                let url = newPage.url();
                if (url === 'about:blank' || url === '') {
                    await newPage.waitForURL((u) => u.href !== 'about:blank', { timeout: 2000 }).catch(() => {});
                    url = newPage.url();
                }

                // Only close if URL is still blank (truly empty popup) OR matches
                // well-known ad patterns — never block OAuth/payment/legit domains.
                const isAdPopup =
                    (url === 'about:blank' || url === '') ||
                    /\/(ad|ads|adserv|adclick|popup|popunder|clicktrack|track|tracker|banner)\b/i.test(url) ||
                    /[?&](utm_|click_id|ref_id|aff_|affiliate)/i.test(url);

                if (isAdPopup) {
                    await newPage.close().catch(() => { });
                    console.error('[popup-blocker] Blocked popup:', url.substring(0, 80));
                }
            } catch (_e) {
                // Ignore errors (page may have already closed)
            }
        });
    }

    return page;
}



