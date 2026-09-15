import { execSync } from "node:child_process";

// Get current active branch as a fallback default
function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return "main";
  }
}

// Read positional arguments:
// process.argv[2] = commit message
// process.argv[3] = branch name
const args = process.argv.slice(2);
const commitMsg = args[0] || "Update";
const branch = args[1] || getCurrentBranch();

function run(cmd, allowFail = false) {
  console.log(`\n> ${cmd}`);
  try {
    return execSync(cmd, { stdio: allowFail ? "pipe" : "inherit" })?.toString();
  } catch (error) {
    if (!allowFail) throw error;
    return null;
  }
}

try {
  run("git add .");

  // Check if there are staged changes to commit
  const status = run("git status --porcelain", true);

  if (!status || status.trim() === "") {
    console.log("\n⚠️  No changes to commit. Proceeding to launch app...");
  } else {
    run(`git commit -m "${commitMsg}"`);
    run(`git push origin ${branch}`);
  }

  // Launch dev server
  run("npm run dev");
} catch (error) {
  console.error("\n❌ Git operation failed. Stopping execution.");
  process.exit(1);
}
