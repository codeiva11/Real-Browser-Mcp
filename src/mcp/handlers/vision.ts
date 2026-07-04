import { solveCaptcha } from './vision-captcha';
import { seePage } from './vision-see-page';

export const visionHandlers = {
  async solve_captcha(params: any = {}) {
    return solveCaptcha(params);
  },

  async see_page(params: any = {}) {
    return seePage(params);
  }
};
