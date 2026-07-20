import { pageController } from "./page-controller.mjs";
import { createConnect } from "../../dist/src/shared/lib-core.js";

export const connect = createConnect(pageController);
