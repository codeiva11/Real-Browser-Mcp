// Vision handlers — delegates to focused implementation files
import { solveCaptcha } from './vision-captcha';
import { seePage } from './vision-see-page';

export const visionHandlers = {
  solve_captcha: (params: any = {}) => solveCaptcha(params),
  see_page:     (params: any = {}) => seePage(params),
};
