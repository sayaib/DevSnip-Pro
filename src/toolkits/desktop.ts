/** Node-only definitions are excluded entirely from the web build. */
import { DESKTOP_DEV_TOOLS } from "./sections/desktop/dev";
import { DESKTOP_MOBILE_TOOLS } from "./sections/desktop/mobile";
import { DESKTOP_AI_TOOLS } from "./sections/desktop/ai";
export const DESKTOP_TOOLS = [...DESKTOP_DEV_TOOLS, ...DESKTOP_MOBILE_TOOLS, ...DESKTOP_AI_TOOLS];
