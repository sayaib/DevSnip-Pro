"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESKTOP_TOOLS = void 0;
/** Node-only definitions are excluded entirely from the web build. */
const dev_1 = require("./sections/desktop/dev");
const mobile_1 = require("./sections/desktop/mobile");
const ai_1 = require("./sections/desktop/ai");
exports.DESKTOP_TOOLS = [...dev_1.DESKTOP_DEV_TOOLS, ...mobile_1.DESKTOP_MOBILE_TOOLS, ...ai_1.DESKTOP_AI_TOOLS];
//# sourceMappingURL=desktop.js.map