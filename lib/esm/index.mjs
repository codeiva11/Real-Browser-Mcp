import { pageController } from "./module/pageController.mjs";
import { createConnect } from "../../dist/src/shared/lib-core.js";

export const connect = createConnect(pageController);
