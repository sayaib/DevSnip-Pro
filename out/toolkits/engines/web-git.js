"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.derivedVersionCode = exports.MAX_VERSION_CODE = exports.bump = exports.describeRange = exports.satisfies = exports.parseRange = exports.compareVersions = exports.formatVersion = exports.parseVersion = exports.missingIgnores = exports.GITIGNORE_MARKERS = exports.buildGitignore = exports.GITIGNORE = exports.commitMessage = exports.COMMIT_TYPES = exports.GIT_RECIPES = void 0;
const types_1 = require("../types");
const q = (s) => (/^[\w./@:+-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);
exports.GIT_RECIPES = [
    { id: "undo-commit-keep", group: "Undo", title: "Undo the last commit, keep the changes", uses: ["count"], explain: "Moves the branch back but leaves the changes staged, so you can fix and recommit. Safe if the commit was not pushed.", commands: p => `git reset --soft HEAD~${p.count}\ngit status   # the changes are staged` },
    { id: "undo-commit-discard", group: "Undo", title: "Delete the last commit and its changes", uses: ["count"], danger: "Uncommitted work and the commit's changes are lost (recoverable for a while via git reflog).", explain: "Resets the branch and the working tree to the commit before.", commands: p => `git reset --hard HEAD~${p.count}` },
    { id: "amend-message", group: "Undo", title: "Fix the last commit message", uses: ["message"], explain: "Rewrites the last commit. If it was already pushed, you must force-push - only do that on your own branch.", commands: p => `git commit --amend -m ${q(p.message)}\n# Only if it was already pushed (your own branch):\ngit push --force-with-lease` },
    { id: "amend-add", group: "Undo", title: "Add forgotten files to the last commit", uses: ["file"], explain: "Stages the files and folds them into the previous commit without changing its message.", commands: p => `git add ${q(p.file)}\ngit commit --amend --no-edit` },
    { id: "revert", group: "Undo", title: "Undo a pushed commit (safely)", uses: ["sha"], explain: "Creates a new commit that reverses the old one. History is not rewritten, so it is safe on shared branches like main.", commands: p => `git revert ${p.sha}\n# Reverting a merge commit: pick the parent to keep (usually 1)\n# git revert -m 1 ${p.sha}\ngit push` },
    { id: "discard-changes", group: "Undo", title: "Throw away all local changes", uses: [], danger: "Every uncommitted change and untracked file is deleted permanently.", explain: "Restores tracked files and removes untracked ones. Run the dry run first.", commands: () => `git restore --staged --worktree .\ngit clean -nd    # dry run: shows what would be deleted\ngit clean -fd    # delete untracked files and folders` },
    { id: "unstage", group: "Undo", title: "Unstage a file (keep the edits)", uses: ["file"], explain: "Removes the file from the next commit; your edits stay in the working tree.", commands: p => `git restore --staged ${q(p.file)}` },
    { id: "restore-file", group: "Undo", title: "Restore one file from another commit or branch", uses: ["file", "sha"], explain: "Replaces the file in the working tree with its version at that commit (or branch name).", commands: p => `git restore --source ${p.sha} -- ${q(p.file)}` },
    { id: "recover", group: "Undo", title: "Recover a lost commit or deleted branch", uses: ["newBranch"], explain: "The reflog records where HEAD has been for ~90 days, including commits removed by reset or rebase.", commands: p => `git reflog --date=relative | head -30\n# Find the commit you want, then:\ngit branch ${p.newBranch} <sha-from-reflog>` },
    { id: "new-branch", group: "Branches", title: "Create a branch and push it", uses: ["newBranch", "base"], explain: "Branches from the latest remote base and sets the upstream so plain git push / git pull work.", commands: p => `git fetch origin\ngit switch -c ${p.newBranch} origin/${p.base}\ngit push -u origin ${p.newBranch}` },
    { id: "rename-branch", group: "Branches", title: "Rename a branch (local and remote)", uses: ["branch", "newBranch"], explain: "Renames locally, pushes the new name and deletes the old remote branch. Open PRs on the old name are closed by GitHub.", commands: p => `git branch -m ${p.branch} ${p.newBranch}\ngit push origin -u ${p.newBranch}\ngit push origin --delete ${p.branch}` },
    { id: "delete-branch", group: "Branches", title: "Delete a branch (local and remote)", uses: ["branch"], explain: "-d refuses to delete unmerged work; use -D to force.", commands: p => `git branch -d ${p.branch}\ngit push origin --delete ${p.branch}` },
    { id: "cleanup-branches", group: "Branches", title: "Delete local branches already merged", uses: ["base"], explain: "Prunes remote-tracking refs, then deletes local branches merged into the base. Review the list before deleting.", commands: p => `git fetch --prune\ngit branch --merged ${p.base} | grep -vE "^\\*|\\b(${p.base}|main|master|develop)\\b"\n# If the list looks right:\ngit branch --merged ${p.base} | grep -vE "^\\*|\\b(${p.base}|main|master|develop)\\b" | xargs git branch -d` },
    { id: "detached", group: "Branches", title: "Fix \"detached HEAD\"", uses: ["newBranch"], explain: "You checked out a commit, not a branch. Keep any work by creating a branch here; otherwise switch back.", commands: p => `# Keep commits made while detached:\ngit switch -c ${p.newBranch}\n# Or discard them and go back:\ngit switch -` },
    { id: "worktree", group: "Branches", title: "Work on two branches at once (worktree)", uses: ["branch"], explain: "Checks out a second branch in another folder - no stashing to fix a hotfix while a feature is half done.", commands: p => `git worktree add ../${p.branch.replace(/[^\w.-]+/g, "-")} ${p.branch}\ngit worktree list\n# When done:\ngit worktree remove ../${p.branch.replace(/[^\w.-]+/g, "-")}` },
    { id: "rebase-base", group: "Sync", title: "Update my branch with the latest main (rebase)", uses: ["base"], explain: "Replays your commits on top of the latest base for a linear history. Requires a force-push if the branch was already pushed.", commands: p => `git fetch origin\ngit rebase origin/${p.base}\n# On conflicts: fix files, then\ngit add <files> && git rebase --continue   # or: git rebase --abort\ngit push --force-with-lease` },
    { id: "merge-base", group: "Sync", title: "Update my branch with the latest main (merge)", uses: ["base"], explain: "Merges the base into your branch; no history rewrite, no force-push.", commands: p => `git fetch origin\ngit merge origin/${p.base}\n# On conflicts: fix files, then\ngit add <files> && git commit` },
    { id: "pull-rejected", group: "Sync", title: "Push rejected (non-fast-forward)", uses: [], explain: "Someone pushed first. Bring their commits in, then push again - do not force-push a shared branch.", commands: () => `git pull --rebase\ngit push\n# Make rebase the default for pulls:\ngit config --global pull.rebase true` },
    { id: "sync-fork", group: "Sync", title: "Sync a fork with the original repository", uses: ["remote", "base"], explain: "Adds the original repo as upstream and updates your fork's base branch.", commands: p => `git remote add upstream ${p.remote}   # once\ngit fetch upstream\ngit switch ${p.base}\ngit rebase upstream/${p.base}\ngit push origin ${p.base}\n# Or with the GitHub CLI: gh repo sync` },
    { id: "conflicts", group: "Sync", title: "Resolve merge conflicts", uses: ["file"], explain: "Conflicted files contain <<<<<<< ======= >>>>>>> markers. Edit them to the right result, stage, and continue.", commands: p => `git status                      # lists conflicted files\ngit diff --name-only --diff-filter=U\n# Take one side for a whole file:\ngit checkout --ours ${q(p.file)}     # keep your version\ngit checkout --theirs ${q(p.file)}   # keep the incoming version\ngit add ${q(p.file)}\ngit merge --continue   # or git rebase --continue` },
    { id: "squash", group: "History", title: "Squash the last N commits into one", uses: ["count", "message"], explain: "Combines recent commits before opening a PR. Force-push needed if they were pushed.", commands: p => `git reset --soft HEAD~${p.count}\ngit commit -m ${q(p.message)}\ngit push --force-with-lease\n# Interactive alternative: git rebase -i HEAD~${p.count}` },
    { id: "cherry-pick", group: "History", title: "Copy a commit to another branch", uses: ["sha", "branch"], explain: "Applies the change of one commit onto the current branch as a new commit (e.g. a hotfix to a release branch).", commands: p => `git switch ${p.branch}\ngit cherry-pick ${p.sha}\n# Several: git cherry-pick A^..B   ·  on conflict: fix, git add, git cherry-pick --continue` },
    { id: "change-author", group: "History", title: "Fix the author of the last commit", uses: ["author"], explain: "Rewrites the author. Also set your identity so it does not happen again.", commands: p => `git commit --amend --author=${q(p.author)} --no-edit\ngit config user.name "Your Name"\ngit config user.email "you@example.com"` },
    { id: "untrack", group: "Secrets & files", title: "Stop tracking a committed file (e.g. .env)", uses: ["file"], explain: "Removes the file from Git but keeps it on disk. It is still in history - if it held secrets, rotate them.", commands: p => `git rm --cached ${q(p.file)}\necho ${q(p.file)} >> .gitignore\ngit add .gitignore\ngit commit -m ${q(`chore: stop tracking ${p.file}`)}` },
    { id: "purge-secret", group: "Secrets & files", title: "Remove a secret file from all history", uses: ["file"], danger: "Rewrites every commit and requires a force-push; all collaborators must re-clone. Rotate the leaked secret regardless - it may already be copied.", explain: "Uses git filter-repo (pip install git-filter-repo), the tool Git itself recommends over filter-branch.", commands: p => `git clone --mirror <repo-url> repo-mirror && cd repo-mirror\ngit filter-repo --path ${q(p.file)} --invert-paths\ngit push --force --mirror\n# GitHub: also ask support to purge cached views and PR refs.` },
    { id: "stash", group: "Secrets & files", title: "Stash work in progress", uses: ["message"], explain: "Shelves uncommitted changes (including untracked files with -u) so you can switch branches.", commands: p => `git stash push -u -m ${q(p.message)}\ngit stash list\ngit stash pop            # re-apply the latest and drop it\ngit stash apply stash@{1} # re-apply a specific one` },
    { id: "lfs", group: "Secrets & files", title: "Track large binary files with Git LFS", uses: ["file"], explain: "Stores big files (designs, videos, models) outside the normal history. GitHub rejects files over 100 MB.", commands: p => `git lfs install\ngit lfs track ${q(p.file.includes("*") ? p.file : "*.psd")}\ngit add .gitattributes\n# Move files that were already committed:\ngit lfs migrate import --include=${q(p.file.includes("*") ? p.file : "*.psd")} --everything` },
    { id: "line-endings", group: "Secrets & files", title: "Fix line-ending (CRLF/LF) noise", uses: [], explain: "A .gitattributes file makes line endings consistent for everyone regardless of OS settings.", commands: () => `printf '* text=auto eol=lf\\n*.{cmd,bat} text eol=crlf\\n*.png binary\\n*.jar binary\\n' > .gitattributes\ngit add --renormalize .\ngit commit -m "chore: normalize line endings"` },
    { id: "pr-checkout", group: "Investigate", title: "Check out a pull request locally", uses: ["count"], explain: "Fetches the PR's head into a local branch to run and review it.", commands: p => `gh pr checkout ${p.count}\n# Without the GitHub CLI:\ngit fetch origin pull/${p.count}/head:pr-${p.count}\ngit switch pr-${p.count}` },
    { id: "bisect", group: "Investigate", title: "Find the commit that introduced a bug", uses: ["sha"], explain: "Binary search through history: mark good and bad commits, Git checks out the midpoint each time.", commands: p => `git bisect start\ngit bisect bad                 # current commit is broken\ngit bisect good ${p.sha}        # a commit that worked\n# test, then mark each step: git bisect good | git bisect bad\n# automate: git bisect run npm test\ngit bisect reset` },
    { id: "who-changed", group: "Investigate", title: "Who changed this line / when was this code added", uses: ["file", "message"], explain: "blame shows the last change per line; log -S finds commits that added or removed a string.", commands: p => `git blame -L 10,40 ${q(p.file)}\ngit log -S ${q(p.message)} --oneline -- ${q(p.file)}\ngit log -p --follow -- ${q(p.file)}` },
    { id: "tag", group: "Releases", title: "Tag a release", uses: ["tag", "message"], explain: "Annotated tags carry a message, date and author; CI release workflows usually trigger on pushed tags.", commands: p => `git tag -a ${p.tag} -m ${q(p.message)}\ngit push origin ${p.tag}\n# Delete a wrong tag: git tag -d ${p.tag} && git push origin :refs/tags/${p.tag}` },
    { id: "two-accounts", group: "Setup", title: "Use two GitHub accounts (work and personal)", uses: [], explain: "Separate SSH keys per account with host aliases, and a different commit email per folder with includeIf.", commands: () => `ssh-keygen -t ed25519 -C "you@work.com" -f ~/.ssh/id_ed25519_work\n\n# ~/.ssh/config\nHost github-work\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519_work\n  IdentitiesOnly yes\n\n# Clone work repos with the alias:\ngit clone git@github-work:company/repo.git\n\n# ~/.gitconfig - work email for everything under ~/work/\n[includeIf "gitdir:~/work/"]\n  path = ~/.gitconfig-work` }
];
// ---------------------------------------------------------------------------
// Conventional Commits
// ---------------------------------------------------------------------------
exports.COMMIT_TYPES = [["feat", "A new feature"], ["fix", "A bug fix"], ["docs", "Documentation only"], ["style", "Formatting, no code change"], ["refactor", "Code change that neither fixes a bug nor adds a feature"], ["perf", "Performance improvement"], ["test", "Adding or fixing tests"], ["build", "Build system or dependencies"], ["ci", "CI configuration"], ["chore", "Maintenance"], ["revert", "Reverts a previous commit"]];
function commitMessage(o) {
    const subject = o.subject.trim();
    if (!subject)
        throw new types_1.ToolInputError("Write a short subject, e.g. \"add password reset email\".");
    const problems = [];
    const scope = o.scope.trim() ? `(${o.scope.trim().toLowerCase()})` : "";
    const bang = o.breaking.trim() ? "!" : "";
    const header = `${o.type}${scope}${bang}: ${subject.replace(/\.$/, "")}`;
    if (header.length > 72)
        problems.push(`The header is ${header.length} characters; keep it under 72 (50 is ideal) so it is not cut off in git log and GitHub.`);
    if (/\.$/.test(subject))
        problems.push("Drop the trailing period from the subject.");
    if (/^[A-Z][a-z]/.test(subject))
        problems.push("Conventional Commits subjects usually start lowercase.");
    if (/^(added|adds|fixed|fixes|updated|updates|changed|changes|removed|removes)\b/i.test(subject))
        problems.push("Use the imperative mood: \"add\", \"fix\", \"update\" - as in \"this commit will add…\".");
    const wrap = (text) => text.split(/\n/).map(line => {
        const out = [];
        let cur = "";
        for (const w of line.split(/\s+/)) {
            if ((cur + " " + w).trim().length > 72) {
                out.push(cur);
                cur = w;
            }
            else
                cur = (cur + " " + w).trim();
        }
        out.push(cur);
        return out.join("\n");
    }).join("\n");
    const footers = [];
    if (o.breaking.trim())
        footers.push(`BREAKING CHANGE: ${o.breaking.trim()}`);
    for (const issue of o.issues.split(/[\s,]+/).filter(Boolean))
        footers.push(/^(closes|fixes|refs|resolves)/i.test(issue) ? issue : `Closes ${issue.startsWith("#") || /^[A-Z]+-\d+$/.test(issue) ? issue : `#${issue}`}`);
    const message = [header, o.body.trim() ? wrap(o.body.trim()) : "", footers.join("\n")].filter(Boolean).join("\n\n");
    const parts = message.split("\n\n");
    const sh = (s) => `'${s.replace(/'/g, "'\\''")}'`;
    const command = `git commit ${parts.map(p => `-m ${sh(p)}`).join(" ")}`;
    const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-");
    const branchType = { feat: "feature", fix: "fix", docs: "docs", refactor: "refactor", perf: "perf", test: "test", build: "build", ci: "ci", chore: "chore", style: "style", revert: "revert" }[o.type] ?? o.type;
    const issue = o.issues.match(/[A-Z]+-\d+|\d+/)?.[0];
    return { message, command, branch: `${branchType}/${issue ? `${issue.toLowerCase()}-` : ""}${slug}`, issues: problems };
}
exports.commitMessage = commitMessage;
// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------
exports.GITIGNORE = {
    node: { label: "Node.js", lines: ["node_modules/", "npm-debug.log*", "yarn-debug.log*", "yarn-error.log*", "pnpm-debug.log*", ".pnpm-store/", ".npm/", ".yarn/*", "!.yarn/patches", "!.yarn/plugins", "!.yarn/releases", "!.yarn/sdks", "!.yarn/versions", "coverage/", "*.tsbuildinfo", "dist/", "build/", ".eslintcache"] },
    next: { label: "Next.js", lines: [".next/", "out/", "next-env.d.ts", ".vercel/"] },
    vite: { label: "Vite / React SPA", lines: ["dist/", "dist-ssr/", "*.local", ".vite/"] },
    nuxt: { label: "Nuxt / Vue", lines: [".nuxt/", ".output/", ".nitro/", ".cache/"] },
    angular: { label: "Angular", lines: [".angular/", "/dist/", "/tmp/"] },
    expo: { label: "Expo / React Native", lines: [".expo/", "expo-env.d.ts", "web-build/", "*.jks", "*.p8", "*.p12", "*.key", "*.mobileprovision", "*.orig.*", "ios/Pods/", "android/.gradle/", "android/app/build/", "android/build/", "*.hprof", ".metro-health-check*", "# Uncomment for managed (CNG) Expo projects:", "# /ios", "# /android"] },
    flutter: { label: "Flutter / Dart", lines: [".dart_tool/", ".flutter-plugins", ".flutter-plugins-dependencies", ".pub-cache/", ".pub/", "build/", "*.iml", "**/doc/api/", "app.*.symbols", "app.*.map.json", "/android/app/debug", "/android/app/profile", "/android/app/release", "lib/generated_plugin_registrant.dart", "coverage/"] },
    android: { label: "Android (Gradle)", lines: ["*.iml", ".gradle/", "local.properties", "/build", "*/build/", "captures/", ".externalNativeBuild/", ".cxx/", "*.apk", "*.aab", "*.ap_", "*.dex", "*.jks", "*.keystore", "keystore.properties", "key.properties", "google-services.json # remove this line if you commit it (it is not secret, but often per-environment)", "*.hprof", "/app/release/"] },
    ios: { label: "iOS / Xcode", lines: ["build/", "DerivedData/", "xcuserdata/", "*.xcuserstate", "*.xcscmblueprint", "*.moved-aside", "Pods/", "*.ipa", "*.dSYM.zip", "*.dSYM", "fastlane/report.xml", "fastlane/Preview.html", "fastlane/screenshots/**/*.png", "fastlane/test_output", "*.mobileprovision", "*.p12", "*.cer", "*.p8", ".build/", "# GoogleService-Info.plist # uncomment if it differs per environment"] },
    python: { label: "Python", lines: ["__pycache__/", "*.py[cod]", ".venv/", "venv/", "env/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", "*.egg-info/", "dist/", "build/", ".ipynb_checkpoints/", ".coverage", "htmlcov/"] },
    java: { label: "Java / Kotlin (Maven, Gradle)", lines: ["target/", "build/", ".gradle/", "*.class", "*.jar", "!gradle/wrapper/gradle-wrapper.jar", "hs_err_pid*", "out/"] },
    go: { label: "Go", lines: ["/bin/", "*.exe", "*.test", "*.out", "vendor/", "go.work.sum"] },
    rust: { label: "Rust", lines: ["target/", "**/*.rs.bk"] },
    dotnet: { label: ".NET", lines: ["bin/", "obj/", "*.user", ".vs/", "TestResults/"] },
    docker: { label: "Docker", lines: ["docker-compose.override.yml", ".docker/"] },
    terraform: { label: "Terraform", lines: [".terraform/", "*.tfstate", "*.tfstate.*", "crash.log", "*.tfvars", "!*.tfvars.example", ".terraform.tfstate.lock.info", "override.tf", "override.tf.json"] },
    env: { label: "Secrets & env files", lines: [".env", ".env.*", "!.env.example", "!.env.sample", "*.pem", "*.key", "secrets/", ".secrets"] },
    macos: { label: "macOS", lines: [".DS_Store", ".AppleDouble", ".LSOverride", "._*"] },
    windows: { label: "Windows", lines: ["Thumbs.db", "ehthumbs.db", "Desktop.ini", "$RECYCLE.BIN/"] },
    linux: { label: "Linux", lines: ["*~", ".directory", ".Trash-*"] },
    vscode: { label: "VS Code", lines: [".vscode/*", "!.vscode/settings.json", "!.vscode/tasks.json", "!.vscode/launch.json", "!.vscode/extensions.json", "*.code-workspace", ".history/"] },
    jetbrains: { label: "JetBrains (IntelliJ, Android Studio)", lines: [".idea/", "*.iws", "*.iml", "out/"] },
    logs: { label: "Logs & temp", lines: ["logs/", "*.log", "tmp/", "temp/", "*.tmp", "*.swp"] }
};
function buildGitignore(keys) {
    const seen = new Set();
    const blocks = [];
    for (const key of keys) {
        const t = exports.GITIGNORE[key];
        if (!t)
            continue;
        const lines = t.lines.filter(l => { const k = l.split(" #")[0].trim(); if (!l.startsWith("#") && seen.has(k))
            return false; seen.add(k); return true; });
        if (lines.length)
            blocks.push(`# ${t.label}\n${lines.join("\n")}`);
    }
    return blocks.join("\n\n") + "\n";
}
exports.buildGitignore = buildGitignore;
/** Files that indicate a stack, for workspace detection. */
exports.GITIGNORE_MARKERS = [["package.json", "node"], ["next.config.js", "next"], ["next.config.mjs", "next"], ["next.config.ts", "next"], ["vite.config.ts", "vite"], ["vite.config.js", "vite"], ["nuxt.config.ts", "nuxt"], ["angular.json", "angular"], ["app.json", "expo"], ["metro.config.js", "expo"], ["pubspec.yaml", "flutter"], ["android/build.gradle", "android"], ["android/build.gradle.kts", "android"], ["build.gradle.kts", "java"], ["build.gradle", "java"], ["settings.gradle.kts", "android"], ["ios/Podfile", "ios"], ["Podfile", "ios"], ["requirements.txt", "python"], ["pyproject.toml", "python"], ["pom.xml", "java"], ["go.mod", "go"], ["Cargo.toml", "rust"], ["Dockerfile", "docker"], ["main.tf", "terraform"]];
function missingIgnores(existing, wanted) {
    const have = new Set(existing.split(/\r?\n/).map(l => l.trim().replace(/^\//, "").replace(/\/$/, "")).filter(l => l && !l.startsWith("#")));
    const must = [".env", "node_modules", ".DS_Store", "*.jks", "*.keystore", "key.properties", "*.p12", "*.p8", "*.mobileprovision", "local.properties", ".dart_tool", "Pods", "DerivedData", ".next", "*.pem"];
    const relevant = new Set(wanted.flatMap(k => exports.GITIGNORE[k]?.lines ?? []).map(l => l.split(" #")[0].trim().replace(/^\//, "").replace(/\/$/, "")));
    return must.filter(m => relevant.has(m) || m === ".env" || m === ".DS_Store").filter(m => !have.has(m) && !(m === ".env" && (have.has(".env*") || have.has(".env.*") && have.has(".env"))));
}
exports.missingIgnores = missingIgnores;
function parseVersion(text) {
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?\s*$/.exec(text);
    if (!m)
        throw new types_1.ToolInputError(`"${text.trim()}" is not a valid semver version (MAJOR.MINOR.PATCH, e.g. 1.4.2 or 2.0.0-beta.1).`);
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".").map(p => (/^\d+$/.test(p) ? +p : p)) : [], build: m[5] ?? "", raw: text.trim() };
}
exports.parseVersion = parseVersion;
const formatVersion = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join(".")}` : ""}`;
exports.formatVersion = formatVersion;
function compareVersions(a, b) {
    for (const k of ["major", "minor", "patch"])
        if (a[k] !== b[k])
            return a[k] < b[k] ? -1 : 1;
    if (!a.pre.length && !b.pre.length)
        return 0;
    if (!a.pre.length)
        return 1;
    if (!b.pre.length)
        return -1;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const x = a.pre[i], y = b.pre[i];
        if (x === undefined)
            return -1;
        if (y === undefined)
            return 1;
        if (x === y)
            continue;
        if (typeof x === "number" && typeof y === "number")
            return x < y ? -1 : 1;
        if (typeof x === "number")
            return -1;
        if (typeof y === "number")
            return 1;
        return x < y ? -1 : 1;
    }
    return 0;
}
exports.compareVersions = compareVersions;
const V = (major, minor, patch, pre = []) => ({ major, minor, patch, pre, build: "", raw: "" });
function partial(text) {
    const m = /^v?(\d+|[xX*])?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
    if (!m)
        throw new types_1.ToolInputError(`Cannot read "${text}" in the range.`);
    const n = (s) => (s === undefined || /^[xX*]$/.test(s) ? undefined : +s);
    return { parts: [n(m[1]), n(m[2]), n(m[3])], pre: m[4] ? m[4].split(".").map(p => (/^\d+$/.test(p) ? +p : p)) : [] };
}
function comparatorsFor(token) {
    const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.*)$/.exec(token.trim());
    const op = m[1] ?? "";
    const { parts: [M, mi, p], pre } = partial(m[2] || "*");
    if (M === undefined)
        return op === "<" || op === ">" ? [{ op: "<", v: V(0, 0, 0, [0]) }] : [];
    const full = mi !== undefined && p !== undefined;
    const lo = V(M, mi ?? 0, p ?? 0, pre);
    switch (op) {
        case "^": {
            const hi = M > 0 || mi === undefined ? V(M + 1, 0, 0, [0]) : mi > 0 || p === undefined ? V(0, mi + 1, 0, [0]) : V(0, 0, p + 1, [0]);
            return [{ op: ">=", v: lo }, { op: "<", v: hi }];
        }
        case "~":
        case "~>": return [{ op: ">=", v: lo }, { op: "<", v: mi === undefined ? V(M + 1, 0, 0, [0]) : V(M, mi + 1, 0, [0]) }];
        case ">": return full ? [{ op: ">", v: lo }] : [{ op: ">=", v: mi === undefined ? V(M + 1, 0, 0) : V(M, mi + 1, 0) }];
        case ">=": return [{ op: ">=", v: lo }];
        case "<": return [{ op: "<", v: full ? lo : V(M, mi ?? 0, 0, [0]) }];
        case "<=": return full ? [{ op: "<=", v: lo }] : [{ op: "<", v: mi === undefined ? V(M + 1, 0, 0, [0]) : V(M, mi + 1, 0, [0]) }];
        default:
            if (full)
                return [{ op: "=", v: lo }];
            return [{ op: ">=", v: lo }, { op: "<", v: mi === undefined ? V(M + 1, 0, 0, [0]) : V(M, mi + 1, 0, [0]) }];
    }
}
function parseRange(range) {
    const text = range.trim() || "*";
    return text.split("||").map(set => {
        const s = set.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, "$1");
        const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(s);
        if (hyphen) {
            const lo = comparatorsFor(`>=${hyphen[1]}`);
            const { parts: [M, mi, p] } = partial(hyphen[2]);
            const hi = M === undefined ? [] : p !== undefined && mi !== undefined ? [{ op: "<=", v: V(M, mi, p) }] : [{ op: "<", v: mi === undefined ? V(M + 1, 0, 0, [0]) : V(M, mi + 1, 0, [0]) }];
            return [...lo, ...hi];
        }
        return s.split(/\s+/).filter(Boolean).flatMap(comparatorsFor);
    });
}
exports.parseRange = parseRange;
function test(c, v) {
    const r = compareVersions(v, c.v);
    return c.op === "=" ? r === 0 : c.op === ">" ? r > 0 : c.op === ">=" ? r >= 0 : c.op === "<" ? r < 0 : r <= 0;
}
function satisfies(v, range) {
    return range.some(set => {
        if (!set.every(c => test(c, v)))
            return false;
        if (!v.pre.length)
            return true;
        // A prerelease only matches when a comparator in the set targets the same major.minor.patch with a prerelease.
        return set.some(c => c.v.pre.length && !(c.v.pre.length === 1 && c.v.pre[0] === 0) && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch);
    });
}
exports.satisfies = satisfies;
function describeRange(range) {
    const fmt = (c) => `${c.op}${(0, exports.formatVersion)({ ...c.v, pre: c.v.pre.length === 1 && c.v.pre[0] === 0 ? [] : c.v.pre })}`;
    return range.map(set => (set.length ? set.map(fmt).join(" ") : "any version")).join("  OR  ");
}
exports.describeRange = describeRange;
function bump(v, kind, preid) {
    const id = preid.trim() || "rc";
    switch (kind) {
        case "major": return V(v.pre.length && v.minor === 0 && v.patch === 0 ? v.major : v.major + 1, 0, 0);
        case "minor": return V(v.major, v.pre.length && v.patch === 0 ? v.minor : v.minor + 1, 0);
        case "patch": return V(v.major, v.minor, v.pre.length ? v.patch : v.patch + 1);
        case "premajor": return V(v.major + 1, 0, 0, [id, 0]);
        case "preminor": return V(v.major, v.minor + 1, 0, [id, 0]);
        case "prepatch": return V(v.major, v.minor, v.patch + 1, [id, 0]);
        case "prerelease": {
            if (!v.pre.length)
                return V(v.major, v.minor, v.patch + 1, [id, 0]);
            const pre = [...v.pre];
            if (pre[0] !== id)
                return V(v.major, v.minor, v.patch, [id, 0]);
            const last = pre[pre.length - 1];
            if (typeof last === "number")
                pre[pre.length - 1] = last + 1;
            else
                pre.push(0);
            return V(v.major, v.minor, v.patch, pre);
        }
        case "release": return V(v.major, v.minor, v.patch);
    }
}
exports.bump = bump;
exports.MAX_VERSION_CODE = 2100000000;
function derivedVersionCode(v, build) {
    return v.major * 10000000 + v.minor * 100000 + v.patch * 1000 + Math.min(build, 999);
}
exports.derivedVersionCode = derivedVersionCode;
//# sourceMappingURL=web-git.js.map