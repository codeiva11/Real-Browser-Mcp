// Form handlers — Form automation and filling
import { requireBrowser, notifyProgress } from './state';
import { handlers } from './index';

// ═══════════════════════════════════════════════════════════════
// Form Handlers — Form automation and filling
// ═══════════════════════════════════════════════════════════════

export const formHandlers = {
  async form_automator(params: any) {
    const { page } = requireBrowser();
    const { selector, data, submit = false, humanLike = true } = params;

    const formSelector = selector || 'form';
    const fields = Object.keys(data || {});

    notifyProgress('form_automator', 'started', `Filling form with ${fields.length} fields`);

    let filledCount = 0;

    for (const [field, value] of Object.entries(data || {})) {
      const inputSelector = `${formSelector} [name="${field}"], ${formSelector} #${field}, ${formSelector} [placeholder*="${field}" i]`;

      try {
        const input = await page.$(inputSelector);
        if (input) {
          const tagName = await input.evaluate(el => el.tagName.toLowerCase());
          const inputType = await input.evaluate(el => el.type);

          if (tagName === 'select') {
            await page.selectOption(inputSelector, String(value));
          } else if (inputType === 'checkbox' || inputType === 'radio') {
            if (value) await input.click();
          } else {
            await input.click({ clickCount: 3 });
            if (humanLike) {
              await page.type(inputSelector, String(value), { delay: 50 + Math.random() * 50 });
            } else {
              await page.type(inputSelector, String(value));
            }
          }
          filledCount++;
          notifyProgress('form_automator', 'progress', `Filled: ${field}`, { field, filledCount });
        }
      } catch (e) {
        // Field not found, continue
      }
    }

    if (submit) {
      await page.click(`${formSelector} [type="submit"], ${formSelector} button`);
      notifyProgress('form_automator', 'progress', 'Form submitted');
    }

    notifyProgress('form_automator', 'completed', `Filled ${filledCount}/${fields.length} fields`, { filledCount, submitted: submit });

    return { success: true, formSelector, fieldsProcessed: filledCount, submitted: submit };
  }
};
