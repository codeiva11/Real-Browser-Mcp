import { checkTurnstile } from './turnstile';

async function pageController({ browser, page, proxy, turnstile }: { browser: any; page: any; proxy: any; turnstile: boolean }) {
    if (page._pageControllerApplied) return page;
    page._pageControllerApplied = true;

    let solveStatus = turnstile;

    page.on('close', () => {
        solveStatus = false;
    });

    async function turnstileSolver() {
        while (solveStatus) {
            if (!page || page.isClosed()) {
                solveStatus = false;
                break;
            }
            await checkTurnstile({ page }).catch(() => { });
            if (!solveStatus || !page || page.isClosed()) break;
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
        context.on('page', async (newPage: any) => {
            try {
                if (newPage.isClosed()) return;
                const opener = await newPage.opener().catch(() => null);
                if (!opener || newPage.isClosed()) return;

                // FIX: Wait for the page to navigate away from about:blank before
                // judging its URL. Firing immediately catches every legitimate popup
                // (OAuth, payment windows, new tabs) while they are still blank.
                // We wait up to 2s for a real URL to appear.
                let url = '';
                try {
                    url = newPage.url();
                } catch {
                    return;
                }
                if (url === 'about:blank' || url === '') {
                    await newPage.waitForURL((u: { href: string }) => u.href !== 'about:blank', { timeout: 2000 }).catch(() => {});
                    if (newPage.isClosed()) return;
                    url = newPage.url();
                }

                // Only close if URL is still blank (truly empty popup) OR matches
                // well-known ad-path patterns. Marketing/affiliate query params
                // (utm_, click_id, ref_id, aff_…) are deliberately NOT treated as
                // ad indicators — they appear on legitimate links all the time.
                const isAdPopup =
                    (url === 'about:blank' || url === '') ||
                    /\/(ad|ads|adserv|adclick|popup|popunder|clicktrack|banner)\b/i.test(url);

                if (isAdPopup && !newPage.isClosed()) {
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

export { pageController };
module.exports = { pageController };
