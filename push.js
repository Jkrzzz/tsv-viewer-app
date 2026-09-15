import { execSync } from "node:child_process";

const commitMsg = process.argv[2] || "Update";
const branch = process.argv[3] || "main";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("git add .");
  run(`git commit -m "${commitMsg}"`);
  run(`git push origin ${branch}`);
  run("npm run dev");
} catch (error) {
  console.error("\n❌ Operation failed. Stopping execution.");
  process.exit(1);
}
