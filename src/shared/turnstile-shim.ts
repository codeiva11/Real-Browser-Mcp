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

                document.querySelectorAll('.cf-turnstile, #challenge-stage').forEach((wrapper: any) => {
                    const iframes = wrapper.querySelectorAll('iframe');
                    if (iframes.length > 0) {
                        const rect = iframes[0].getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                        }
                    } else {
                        const emptyDivs = Array.from(wrapper.querySelectorAll('div')).filter((d: any) => !d.querySelector('*'));
                        if (emptyDivs.length > 0) {
                            const target = emptyDivs.reduce((prev: any, current: any) => {
                                const pRect = prev.getBoundingClientRect();
                                const cRect = current.getBoundingClientRect();
                                return (pRect.width * pRect.height > cRect.width * cRect.height) ? prev : current;
                            });
                            const rect = (target as any).getBoundingClientRect();
                            if (rect.width > 50 && rect.height > 20) {
                                coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            }
                        }
                    }
                });

                if (coords.length === 0) {
                    document.querySelectorAll('div, iframe').forEach((item: any) => {
                        try {
                            const rect = item.getBoundingClientRect();
                            const css = window.getComputedStyle(item);
                            const isWidgetSize = rect.width >= 150 && rect.width <= 400 && rect.height >= 40 && rect.height <= 100;
                            if (isWidgetSize) {
                                if (item.tagName === 'IFRAME') coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                                else if (!item.querySelector('*')) coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            }
                        } catch (_) {}
                    });
                }
                return coords;
            });

            for (const item of coordinates) {
                try {
                    let x = item.x + Math.min(30, item.w / 4);
                    let y = item.y + item.h / 2;
                    await page.mouse.click(x, y);
                } catch (_) {}
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
                    let x = box.x + Math.min(30, box.width / 4);
                    let y = box.y + box.height / 2;
                    await page.mouse.click(x, y);
                }
            } catch (_) {}
        }
        return true;
    } catch (_) {
        return false;
    }
};

export { checkTurnstile };
