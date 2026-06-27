// @ts-nocheck
export {};
const { pageController } = require("./module/pageController.js");
const { createConnect } = require("../../src/shared/lib-core.js");

const connect = createConnect(pageController);

module.exports = { connect };
