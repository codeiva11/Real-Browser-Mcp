import { pageController } from './module/pageController';
import { createConnect } from '../../src/shared/lib-core';

const connect: ReturnType<typeof createConnect> = createConnect(pageController);

export { connect };
module.exports = { connect };
