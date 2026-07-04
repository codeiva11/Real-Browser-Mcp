const checkTurnstile = async ({ page }: { page: any }): Promise<boolean> => {
    try {
        const elements = await page.locator('[name="cf-turnstile-response"]').all();
        if (elements.length <= 0) {
            const isChallenge = await page.evaluate(() => {
                return document.title.includes('Just a moment') || 
                       document.querySelector('#challenge-stage') !== null ||
                       document.querySelector('.cf-turnstile') !== null;
            });
            if (!isChallenge) return false;

            const coordinates: Array<{x: number, y: number, w: number, h: number}> = await page.evaluate(() => {
                let coords: Array<{x: number, y: number, w: number, h: number}> = [];
                document.querySelectorAll('div').forEach(item => {
                    try {
                        let itemCoordinates = item.getBoundingClientRect();
                        let itemCss = window.getComputedStyle(item);
                        if (itemCss.margin === "0px" && itemCss.padding === "0px" && itemCoordinates.width > 290 && itemCoordinates.width <= 310 && !item.querySelector('*')) {
                            coords.push({ x: itemCoordinates.x, y: item.getBoundingClientRect().y, w: item.getBoundingClientRect().width, h: item.getBoundingClientRect().height });
                        }
                    } catch (_err) { }
                });

                if (coords.length <= 0) {
                    document.querySelectorAll('div').forEach(item => {
                        try {
                            let itemCoordinates = item.getBoundingClientRect();
                            if (itemCoordinates.width > 290 && itemCoordinates.width <= 310 && !item.querySelector('*')) {
                                coords.push({ x: itemCoordinates.x, y: item.getBoundingClientRect().y, w: item.getBoundingClientRect().width, h: item.getBoundingClientRect().height });
                            }
                        } catch (_err) { }
                    });
                }
                return coords;
            });

            for (const item of coordinates) {
                try {
                    let x = item.x + 30;
                    let y = item.y + item.h / 2;
                    await page.mouse.click(x, y);
                } catch (_err) { }
            }
            return true;
        }

        for (const element of elements) {
            try {
                const box = await element.evaluate((el: any) => {
                    const parent = el.parentElement;
                    if (!parent) return null;
                    const rect = parent.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                });
                if (box) {
                    let x = box.x + 30;
                    let y = box.y + box.height / 2;
                    await page.mouse.click(x, y);
                }
            } catch (_err) { }
        }
        return true;
    } catch (_err) {
        return false;
    }
};

export { checkTurnstile };
module.exports = { checkTurnstile };
