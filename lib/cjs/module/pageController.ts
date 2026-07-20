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
            await checkTurnstile({ page }).catch(() => { });
            // Unref the idle timer so this background loop never keeps the
            // Node process alive on its own. It still runs while the event
            // loop is active (i.e. while the server/browser is running).
            await new Promise<void>(r => {
                const t = setTimeout(r, 1000);
                if (typeof t.unref === 'function') t.unref();
            });
        }
    }

    if (solveStatus) {
        // Fire-and-forget background solver. It stops itself when the page
        // closes (page.on('close') sets solveStatus=false).
        turnstileSolver().catch(() => { });
    }

    const context = page.context();
    if (!context._popupBlockerApplied) {
        context._popupBlockerApplied = true;
        context.on('page', async (newPage: any) => {
            try {
                const opener = await newPage.opener();
                if (opener) {
                    const url = newPage.url();
                    const isAdPopup = url === 'about:blank' ||
                        url.includes('ad') ||
                        url.includes('pop') ||
                        url.includes('click') ||
                        url.includes('redirect') ||
                        url.includes('track');
                    if (isAdPopup) {
                        await newPage.close().catch(() => { });
                        console.error('[popup-blocker] Blocked popup ad:', url.substring(0, 50));
                    }
                }
            } catch (_e) {
                // Ignore errors
            }
        });
    }

    return page;
}

export { pageController };
module.exports = { pageController };
