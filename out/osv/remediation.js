"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remediationFor = exports.isSafeToken = void 0;
/**
 * Upgrade commands and guidance for a vulnerable package.
 *
 * The scanner never runs these by itself: the panel shows them, offers to
 * copy them, and only sends one to a terminal after the user confirms it in a
 * modal dialog. Package names and versions come from parsed files, so every
 * value placed in a command is checked against a conservative character set
 * first; anything that does not match gets guidance text instead of a command.
 */
const SAFE_NAME = /^[A-Za-z0-9@][A-Za-z0-9@/._:+-]*$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
function isSafeToken(value, kind) {
    return value.length <= 214 && (kind === "name" ? SAFE_NAME : SAFE_VERSION).test(value);
}
exports.isSafeToken = isSafeToken;
function where(project) {
    return project || ".";
}
/** Commands for one project (directory + package manager) that uses the package. */
function planFor(ecosystem, manager, name, target, occurrence) {
    const cwd = occurrence.project;
    const direct = occurrence.direct === true;
    const dev = occurrence.scope === "development";
    const cmd = (label, command) => ({ label, command, cwd });
    switch (manager) {
        case "npm":
            return direct
                ? { commands: [cmd("Upgrade with npm", `npm install ${name}@${target}${dev ? " --save-dev" : ""}`)], guidance: [] }
                : { commands: [cmd("Update within ranges", `npm update ${name}`)], guidance: [`${name} is a transitive dependency. If \`npm update\` cannot reach ${target}, upgrade the package that depends on it (\`npm ls ${name}\` shows which), or add an "overrides" entry for ${name} in package.json.`] };
        case "yarn":
            return direct
                ? { commands: [cmd("Upgrade with Yarn", `yarn add ${name}@${target}${dev ? " --dev" : ""}`)], guidance: [] }
                : { commands: [cmd("Upgrade within ranges", `yarn upgrade ${name}`)], guidance: [`${name} is a transitive dependency. Upgrade the package that depends on it (\`yarn why ${name}\`), or add a "resolutions" entry in package.json.`] };
        case "yarn-berry":
            return direct
                ? { commands: [cmd("Upgrade with Yarn", `yarn up ${name}@${target}`)], guidance: [] }
                : { commands: [cmd("Refresh the lockfile entry", `yarn up -R ${name}`)], guidance: [`${name} is a transitive dependency; \`yarn why ${name}\` shows which package pulls it in. A "resolutions" entry in package.json can force ${target}.`] };
        case "pnpm":
            return direct
                ? { commands: [cmd("Upgrade with pnpm", `pnpm add ${name}@${target}${dev ? " --save-dev" : ""}`)], guidance: [] }
                : { commands: [cmd("Update transitive copies", `pnpm update --depth Infinity ${name}`)], guidance: [`${name} is a transitive dependency. If it stays below ${target}, upgrade its parent (\`pnpm why ${name}\`) or add it to "pnpm.overrides" in package.json.`] };
        case "bun":
            return direct
                ? { commands: [cmd("Upgrade with Bun", `bun add ${name}@${target}${dev ? " --dev" : ""}`)], guidance: [] }
                : { commands: [], guidance: [`${name} is a transitive dependency. Upgrade the package that depends on it, or add an "overrides" entry in package.json.`] };
        case "pip": {
            const file = occurrence.file;
            return { commands: [cmd("Install the fixed version", `python -m pip install "${name}>=${target}"`)],
                guidance: [`Then raise the requirement in ${file} to \`${name}>=${target}\`${occurrence.resolution === "pinned" ? ` (it is pinned to ${occurrence.spec ?? "an older version"})` : ""} so the next install keeps the fix.`] };
        }
        case "pipenv": return { commands: [cmd("Upgrade with Pipenv", `pipenv upgrade ${name}`)], guidance: [`If the Pipfile constraint keeps ${name} below ${target}, raise it to \`>=${target}\` first.`] };
        case "poetry":
            return direct
                ? { commands: [cmd("Upgrade with Poetry", `poetry add "${name}>=${target}"${dev ? " --group dev" : ""}`)], guidance: [] }
                : { commands: [cmd("Update the lockfile entry", `poetry update ${name}`)], guidance: [`${name} is a transitive dependency; \`poetry show --tree\` shows which package requires it.`] };
        case "uv": return { commands: [cmd("Upgrade with uv", `uv lock --upgrade-package ${name}==${target}`)], guidance: direct ? [] : [`${name} is a transitive dependency; if a parent's constraint blocks ${target}, upgrade the parent.`] };
        case "conda": return { commands: [], guidance: [`${name} is installed by pip inside a conda environment: raise it to ${target} in the pip section of environment.yml${occurrence.resolution === "lockfile" ? " and regenerate the lock (conda-lock)" : ""}.`] };
        case "pdm": return { commands: [cmd("Upgrade with PDM", `pdm update ${name}`)], guidance: [`If a constraint keeps ${name} below ${target}, raise it in pyproject.toml.`] };
        case "maven": {
            const [group, artifact] = name.split(":");
            return { commands: [], guidance: [direct
                        ? `Set the version of ${group}:${artifact} to ${target} in ${occurrence.file}${occurrence.spec && !/^\d/.test(occurrence.spec) ? " (or in the property it references)" : ""}.`
                        : `${name} arrives transitively. Pin it to ${target} in <dependencyManagement> of ${occurrence.file}, or upgrade the dependency that brings it in (\`mvn dependency:tree -Dincludes=${group}:${artifact}\`).`] };
        }
        case "gradle":
            return { commands: [], guidance: [direct
                        ? `Change ${name} to ${target} in ${occurrence.file}.`
                        : `${name} arrives transitively. Add a dependency constraint (\`constraints { implementation("${name}:${target}") }\`) or upgrade the dependency that brings it in (\`gradle dependencyInsight --dependency ${name.split(":")[1] ?? name}\`).`]
                    .concat(occurrence.file.endsWith(".lockfile") ? ["Then refresh the lockfile with `--write-locks`."] : []) };
        case "go": {
            const version = target.startsWith("v") ? target : `v${target}`;
            return { commands: [cmd("Upgrade the module", `go get ${name}@${version}`), cmd("Tidy go.mod", "go mod tidy")], guidance: [] };
        }
        case "cargo": return { commands: [cmd("Update the lockfile", `cargo update -p ${name} --precise ${target}`)], guidance: [`If Cargo.toml's requirement does not allow ${target}, raise it there first.`] };
        case "bundler": return { commands: [cmd("Update with Bundler", `bundle update ${name} --conservative`)], guidance: [`If the Gemfile constraint keeps ${name} below ${target}, change it to allow ${target}.`] };
        case "nuget": {
            if (occurrence.file.endsWith("packages.config"))
                return { commands: [], guidance: [`Update ${name} to ${target} with the NuGet Package Manager (packages.config projects cannot use \`dotnet add package\`).`] };
            return direct
                ? { commands: [cmd("Upgrade with dotnet", `dotnet add package ${name} --version ${target}`)], guidance: [] }
                : { commands: [], guidance: [`${name} is a transitive dependency. Reference it directly at ${target} (\`dotnet add package ${name} --version ${target}\`) or upgrade the package that brings it in (\`dotnet list package --include-transitive\`).`] };
        }
        case "composer":
            return direct
                ? { commands: [cmd("Upgrade with Composer", `composer require ${name}:^${target}${dev ? " --dev" : ""}`)], guidance: [] }
                : { commands: [cmd("Update the lockfile entry", `composer update ${name} --with-dependencies`)], guidance: [`${name} is a transitive dependency; \`composer why ${name}\` shows which package requires it.`] };
        case "pub": return { commands: [cmd("Upgrade with pub", `dart pub upgrade ${name}`)], guidance: [`For Flutter apps use \`flutter pub upgrade ${name}\`. If pubspec.yaml's constraint keeps ${name} below ${target}, raise it to \`^${target}\`.`] };
        case "mix": return { commands: [cmd("Update with Mix", `mix deps.update ${name}`)], guidance: [`If mix.exs keeps ${name} below ${target}, raise the requirement there.`] };
        case "swiftpm": return { commands: [cmd("Update packages", "swift package update")], guidance: [`Make sure Package.swift (or the Xcode project) allows ${target} for ${name}.`] };
        case "renv": return { commands: [], guidance: [`In R, run \`renv::install("${name}@${target}")\` and then \`renv::snapshot()\`.`] };
    }
    return { commands: [], guidance: [] };
}
/**
 * Commands and guidance for upgrading `name` to `target` in every project that
 * uses it. Commands are de-duplicated per directory.
 */
function remediationFor(ecosystem, name, target, occurrences) {
    if (!target) {
        return { commands: [], guidance: [] };
    }
    if (!isSafeToken(name, "name") || !isSafeToken(target.replace(/^v/, ""), "version")) {
        return { commands: [], guidance: [`Upgrade ${name} to ${target} with your package manager. (No command is suggested because the name or version contains unusual characters.)`] };
    }
    const commands = [];
    const guidance = [];
    const seen = new Set();
    for (const occurrence of occurrences) {
        const plan = planFor(ecosystem, occurrence.manager, name, target, occurrence);
        for (const command of plan.commands) {
            const key = `${command.cwd}\u0000${command.command}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            commands.push(command);
        }
        for (const line of plan.guidance) {
            const text = occurrences.length > 1 || occurrence.project ? `${where(occurrence.project)}: ${line}` : line;
            if (!guidance.includes(text))
                guidance.push(text);
        }
    }
    return { commands, guidance };
}
exports.remediationFor = remediationFor;
//# sourceMappingURL=remediation.js.map