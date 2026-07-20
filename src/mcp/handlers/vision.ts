// Vision handlers — delegates to focused implementation files
import { solveCaptcha } from './vision-captcha';
import { seePage } from './vision-see-page';
import { browseTask } from './vision-browse-task';

export const visionHandlers = {
  solve_captcha: (params: any = {}) => solveCaptcha(params),
  see_page:      (params: any = {}) => seePage(params),
  browse_task:   (params: any = {}) => browseTask(params),
};
