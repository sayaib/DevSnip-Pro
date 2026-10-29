import type { ToolContext } from "../toolkits/types";
/** Browsers cannot inspect local TCP ports. No network capability is exposed. */
export const toolNetwork: ToolContext["network"] = undefined;
