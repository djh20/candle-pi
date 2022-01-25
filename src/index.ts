/*     
  ____ ____ ____ ___  ___  ____ ____ ____ _   _ ____ ____ _  _
  |__/ |__| [__  |__] |__] |___ |__/ |__/  \_/  |    |__| |\ |
  |  \ |  | ___] |    |__] |___ |  \ |  \   |   |___ |  | | \|
  Delta Edition
  
  Created & developed by djh20.
*/

import Application, { Config } from "./application";

// Load the version string from package.json so it can be displayed. Also load
// the config.json file (this should probably use the fs module instead).
const { version } = require("../package.json");
const config: Config = require("../config.json");

// Log splash art to console; some characters have been escaped so it looks
// a bit weird in the editor.
console.log(`
____ ____ ____ ___  ___  ____ ____ ____ _   _ ____ ____ _  _
|__/ |__| [__  |__] |__] |___ |__/ |__/  \\_/  |    |__| |\\ |
|  \\ |  | ___] |    |__] |___ |  \\ |  \\   |   |___ |  | | \\|
Delta Edition  ${version}
`);

const app = new Application(config)
app.start();