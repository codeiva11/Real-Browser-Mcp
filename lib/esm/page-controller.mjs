"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
export { pageController };
import * as turnstile_shim_1 from './turnstile-shim.mjs';
async function pageController({ browser, page, proxy, turnstile }) {
    if (page._pageControllerApplied)
        return page;
    page._pageControllerApplied = true;
    let solveStatus = turnstile;
    page.on('close', () => {
        solveStatus = false;
    });
    async function turnstileSolver() {
        while (solveStatus) {
            await (0, turnstile_shim_1.checkTurnstile)({ page }).catch(() => { });
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    if (solveStatus) {
        turnstileSolver();
    }
    const context = page.context();
    if (!context._popupBlockerApplied) {
        context._popupBlockerApplied = true;
        context.on('page', async (newPage) => {
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
            }
            catch (_e) {
                // Ignore errors
            }
        });
    }
    return page;
}
//# sourceMappingURL=page-controller.js.map