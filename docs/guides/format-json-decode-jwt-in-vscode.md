# Format JSON and YAML, decode JWTs and other quick developer tools in VS Code

**Short answer:** instead of pasting a production payload or a real token into a website, use local tools in the editor. [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) has a JSON / YAML / XML formatter, a JWT decoder and signer, a cURL converter, a regex tester, encoders, timestamp and UUID tools and 100+ more, all running locally in one searchable sidebar.

![All DevSnip Pro tools in one searchable grid in VS Code, grouped into 13 sections](../images/all-tools.jpg)

Most lost time in a developer's day is not hard problems. It is dozens of small detours: a website to format JSON, another to decode a JWT, a search for the right `git` command, a script to convert a timestamp. Each takes a minute and pulls you out of the editor. There are 110 tools in 13 sections, all reachable from one sidebar.

## Find any tool in two keystrokes

Open the **DevSnip Pro** view in the Activity Bar and press <kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd> (or <kbd>/</kbd>) to search. **Star** the tools you use most; they are listed under **Favorites**, and the ones you used last are under **Recent**. **DevSnip Pro: Browse All Tools** shows everything as a searchable grid.

Most toolkit panels end with the same four actions: **Copy**, **Insert at cursor**, **Open in editor** and **Save**. Save always asks before overwriting.

## Text and data, without a browser tab

| Task | Tool |
| :--- | :--- |
| Format, minify, validate or convert JSON, YAML and XML | **JSON / YAML / XML Formatter** |
| Compare two texts, or two JSON documents structurally | **Diff Checker** |
| Test a regex with groups, and copy it as code for 9 languages | **Regex Tester & Library** |
| Convert camelCase / snake_case / kebab-case; sort and de-duplicate lines | **Case Converter & Text Tools** |
| Base64, URL, HTML entity, hex and Unicode encoding | **Encode / Decode** |
| Decode a JWT, check its expiry, verify or sign a test token | **JWT Decoder & Signer** |
| Turn a cURL command into fetch, Axios, Python, Go and more | **cURL Converter** |
| Unix time ↔ dates, time zones, date math | **Timestamp Converter** |
| UUID v4/v7, ULID, Nano ID, ObjectId | **UUID & ID Generator** |
| Types from a JSON sample | **JSON to Types** |

These run locally, which matters when the JSON is a production payload or the JWT is a real token: nothing is pasted into a third-party website.

## Git without searching for the command

**Git Command Recipes** gives the exact commands for common situations (undo the last commit, rename a branch, squash, recover a deleted branch) and helps write commit messages. **.gitignore Generator** detects your stack from the workspace.

## Keep the codebase tidy

- **Create Snippet** turns a selection into an IntelliSense snippet; **Saved Snippets** lists and deletes them.
- **Clean Console Logs** and **Remove Unused Imports** clean up before a commit.
- **Dependencies & Installation** shows every dependency with its declared range, installed version and the latest allowed and stable versions, for npm, yarn, pnpm, pip, Maven and Gradle. It runs nothing without showing you the exact command first.

## DevOps boilerplate that is checked

Generators for Dockerfiles, Compose files, CI pipelines, Kubernetes and Helm, Terraform, Nginx and PM2 produce configuration that the extension's test suite validates: YAML and JSON parse, code compiles, and Compose files pass `docker compose config`. Start from that and adjust, instead of from a blog post's snippet.

## Make it comfortable

Pick one of twelve appearance themes for every DevSnip Pro panel from the **Theme** selector at the top of the sidebar; System Default is free and the others unlock with points you earn by using the extension. Points, streaks and milestones are optional and stay on your machine; they record what you have tried rather than asking for more clicks.

## The habit that helps most

Every time you open a browser tab for a small conversion or a lookup, check whether the sidebar search has it. After a week, the detours are mostly gone.

---

**Try it:** [Install DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) (free, no account) or run `code --install-extension sayaib.hue-console`.

Related: [How to test REST APIs in VS Code](test-rest-apis-in-vscode.md) · [How to connect to PostgreSQL, MySQL, MongoDB and Redis in VS Code](connect-to-postgresql-mysql-mongodb-redis-in-vscode.md) · [All guides](README.md)
