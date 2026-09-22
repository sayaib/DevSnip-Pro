import Mocha = require("mocha");
import * as path from "path";
import glob = require("glob");

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30000 });
  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((resolve, reject) => {
    // Only the VS Code integration specs: the unit suite runs in plain Node.
    glob("**/*.test.js", { cwd: testsRoot, ignore: ["unit/**"] }, (error, files) => {
      if (error) return reject(error);
      files.forEach(file => mocha.addFile(path.resolve(testsRoot, file)));
      try {
        mocha.run(failures => (failures ? reject(new Error(`${failures} test failure(s).`)) : resolve()));
      } catch (runError) {
        reject(runError);
      }
    });
  });
}
