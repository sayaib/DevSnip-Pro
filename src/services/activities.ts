/**
 * Daily activities in Redeem: the spin wheel, the daily dev challenge, the
 * Bit Sprint mini-game, the tip of the day, the weekly event, the check-in
 * chest and lucky finds.
 *
 * Every activity is once a day (or once a week), so there is always a reason to
 * come back but never a reason to grind. Each one teaches something or points
 * at a tool worth knowing, and pays points or an exclusive reward.
 *
 * Pure: no vscode import, so it is unit tested directly.
 */

import type { ToolRunEvent } from "./quests";

// ---------------------------------------------------------------- daily challenge

export interface QuizQuestion {
  id: string;
  category: string;
  question: string;
  /** Optional code shown under the question. */
  code?: string;
  options: string[];
  /** Index into options. */
  answer: number;
  /** Why the answer is right: shown after answering, right or wrong. */
  explain: string;
}

export const QUIZ_CORRECT_POINTS = 15;
/** Trying counts too: a wrong answer still teaches something. */
export const QUIZ_TRY_POINTS = 3;

export const QUIZ_BANK: QuizQuestion[] = [
  { id: "js_typeof_null", category: "JavaScript", question: "What does this return?", code: "typeof null", options: ["\"null\"", "\"object\"", "\"undefined\"", "\"NaN\""], answer: 1, explain: "A bug from the first version of JavaScript that can never be fixed. Check for null with value === null." },
  { id: "js_map_parseint", category: "JavaScript", question: "What does this evaluate to?", code: "[\"1\", \"2\", \"3\"].map(parseInt)", options: ["[1, 2, 3]", "[1, NaN, NaN]", "[NaN, NaN, NaN]", "[1, 2, NaN]"], answer: 1, explain: "map passes (value, index), so parseInt gets the index as the radix: parseInt(\"2\", 1) and parseInt(\"3\", 2) are NaN. Use .map(Number) or .map(s => parseInt(s, 10))." },
  { id: "js_float", category: "JavaScript", question: "What does this log?", code: "console.log(0.1 + 0.2 === 0.3)", options: ["true", "false", "TypeError", "undefined"], answer: 1, explain: "Binary floating point cannot store 0.1 exactly, so the sum is 0.30000000000000004. Compare with Math.abs(a - b) < Number.EPSILON, or work in integers (cents)." },
  { id: "js_plus_minus", category: "JavaScript", question: "What are the two results?", code: "\"5\" + 3\n\"5\" - 3", options: ["8 and 2", "\"53\" and 2", "\"53\" and \"2\"", "8 and \"2\""], answer: 1, explain: "+ concatenates when either side is a string; - only works on numbers, so \"5\" is converted to 5." },
  { id: "js_allsettled", category: "JavaScript", question: "What does Promise.allSettled do when one promise rejects?", options: ["Rejects straight away", "Waits for all and reports each one's status", "Ignores the rejected one", "Retries the rejected one"], answer: 1, explain: "It never rejects: you get { status: \"fulfilled\", value } or { status: \"rejected\", reason } for every promise. Promise.all rejects on the first failure." },
  { id: "js_const", category: "JavaScript", question: "Which is true about const?", code: "const list = [1, 2];\nlist.push(3);", options: ["push throws a TypeError", "list is now [1, 2, 3]", "list is frozen", "const only works for numbers"], answer: 1, explain: "const stops the variable being reassigned, not the object being changed. Use Object.freeze for a (shallow) read-only object." },
  { id: "ts_as_const", category: "TypeScript", question: "What is the type of x?", code: "const x = \"hi\" as const;", options: ["string", "\"hi\"", "readonly string", "any"], answer: 1, explain: "as const keeps the narrowest literal type. On objects and arrays it also makes every property readonly." },
  { id: "ts_partial", category: "TypeScript", question: "Which utility type makes every property optional?", options: ["Required<T>", "Partial<T>", "Pick<T, K>", "Readonly<T>"], answer: 1, explain: "Partial<T> is handy for update payloads, e.g. function update(id: string, changes: Partial<User>)." },
  { id: "ts_unknown", category: "TypeScript", question: "What is the difference between unknown and any?", options: ["None", "unknown must be narrowed before you use it", "any must be narrowed before you use it", "unknown only holds strings"], answer: 1, explain: "Both accept any value, but unknown makes you check the type first (typeof, instanceof, a type guard). Prefer it for parsed JSON and caught errors." },
  { id: "git_soft_reset", category: "Git", question: "Undo the last commit but keep its changes staged:", options: ["git reset --hard HEAD~1", "git reset --soft HEAD~1", "git revert HEAD", "git checkout HEAD~1"], answer: 1, explain: "--soft moves the branch back and keeps everything staged. --hard throws the changes away; revert adds a new commit that undoes it (safer once pushed)." },
  { id: "git_switch", category: "Git", question: "Create a new branch and switch to it:", options: ["git branch -m feature", "git switch -c feature", "git checkout feature", "git merge feature"], answer: 1, explain: "git switch -c (or the older git checkout -b) creates the branch from where you are and moves you onto it." },
  { id: "git_stash_pop", category: "Git", question: "What does git stash pop do?", options: ["Deletes every stash", "Applies the newest stash and removes it from the list", "Applies the oldest stash", "Pushes the stash to the remote"], answer: 1, explain: "pop = apply + drop. Use git stash apply to keep the stash around, and git stash list to see them all." },
  { id: "git_force_lease", category: "Git", question: "The safest way to force-push a rebased branch:", options: ["git push --force", "git push --force-with-lease", "git push --all", "git push --no-verify"], answer: 1, explain: "--force-with-lease refuses to overwrite commits someone else pushed since you last fetched, so you cannot silently delete their work." },
  { id: "http_201", category: "HTTP", question: "Which status code means \"a new resource was created\"?", options: ["200", "201", "204", "302"], answer: 1, explain: "201 Created, ideally with a Location header pointing at the new resource. 204 means success with no body." },
  { id: "http_403", category: "HTTP", question: "You are logged in, but not allowed to see the resource. Which code?", options: ["400", "401", "403", "404"], answer: 2, explain: "401 means \"who are you?\" (not authenticated); 403 means \"I know who you are, and no\"." },
  { id: "http_put", category: "HTTP", question: "Which method is idempotent but not safe?", options: ["GET", "POST", "PUT", "PATCH"], answer: 2, explain: "Sending the same PUT twice leaves the same state (idempotent) but it changes data (not safe). GET is safe; POST and PATCH are not guaranteed idempotent." },
  { id: "http_429", category: "HTTP", question: "What does HTTP 429 mean?", options: ["Payload too large", "Too many requests", "Gateway timeout", "Conflict"], answer: 1, explain: "You hit a rate limit. Back off, ideally for as long as the Retry-After header says." },
  { id: "http_cors", category: "HTTP", question: "Who enforces CORS?", options: ["The server", "The browser", "The firewall", "DNS"], answer: 1, explain: "The server only sends Access-Control-* headers; the browser decides whether the page may read the response. curl and server-to-server calls ignore CORS." },
  { id: "re_phone", category: "Regex", question: "Which string matches?", code: "^\\d{3}-\\d{4}$", options: ["5551234", "555-1234", "555-12345", "a55-1234"], answer: 1, explain: "Exactly three digits, a dash, exactly four digits, and ^...$ anchors the whole string so nothing extra is allowed." },
  { id: "re_lazy", category: "Regex", question: "What does the ? do in .*?", options: ["Makes the group optional", "Makes the match lazy (as short as possible)", "Matches a literal ?", "Nothing"], answer: 1, explain: "<.*> on \"<a><b>\" matches the whole string; <.*?> matches just \"<a>\"." },
  { id: "re_boundary", category: "Regex", question: "What does \\b match?", options: ["A backspace", "A word boundary", "Any blank", "The letter b"], answer: 1, explain: "A zero-width position between a word character and a non-word character: \\bcat\\b matches \"cat\" but not \"concatenate\"." },
  { id: "sql_left_join", category: "SQL", question: "Which join keeps every row from the left table, matched or not?", options: ["INNER JOIN", "LEFT JOIN", "CROSS JOIN", "SELF JOIN"], answer: 1, explain: "Unmatched left rows come back with NULLs for the right table's columns, which is how you find \"customers with no orders\"." },
  { id: "sql_having", category: "SQL", question: "Filter groups by an aggregate, e.g. COUNT(*) > 5:", options: ["WHERE", "HAVING", "ORDER BY", "LIMIT"], answer: 1, explain: "WHERE filters rows before grouping; HAVING filters groups after GROUP BY." },
  { id: "sql_count", category: "SQL", question: "How does COUNT(email) differ from COUNT(*)?", options: ["It is faster", "It skips rows where email is NULL", "It counts distinct emails", "No difference"], answer: 1, explain: "COUNT(column) counts non-NULL values. Use COUNT(DISTINCT email) for unique ones." },
  { id: "sh_redirect", category: "Shell", question: "What does 2>&1 do?", code: "npm test > log.txt 2>&1", options: ["Runs the command twice", "Sends errors to the same place as normal output", "Discards errors", "Appends to the file"], answer: 1, explain: "File descriptor 2 (stderr) is pointed at wherever 1 (stdout) goes, so log.txt gets both. Order matters: > first, then 2>&1." },
  { id: "sh_chmod", category: "Shell", question: "What does chmod 755 give?", options: ["Everyone can write", "Owner rwx, group and others r-x", "Owner rw-, others ---", "Only root can run it"], answer: 1, explain: "7 = rwx, 5 = r-x. Typical for scripts and directories; 644 is typical for plain files." },
  { id: "sh_status", category: "Shell", question: "What does $? hold?", options: ["The process id", "The exit status of the last command", "The number of arguments", "The last argument"], answer: 1, explain: "0 means success, anything else is a failure. $$ is the shell's PID and $# is the argument count." },
  { id: "sec_passwords", category: "Security", question: "How should passwords be stored?", options: ["SHA-256", "AES encryption", "Argon2 or bcrypt", "Base64"], answer: 2, explain: "Use a deliberately slow, salted password hash. Fast hashes like SHA-256 can be brute-forced; encryption can be reversed; Base64 is just encoding." },
  { id: "sec_sqli", category: "Security", question: "The reliable fix for SQL injection:", options: ["Escaping quotes by hand", "Parameterised queries", "Hiding error messages", "Using POST instead of GET"], answer: 1, explain: "Placeholders send data separately from the SQL, so input can never become code." },
  { id: "sec_httponly", category: "Security", question: "Which cookie flag stops JavaScript reading the cookie?", options: ["Secure", "HttpOnly", "SameSite", "Path"], answer: 1, explain: "HttpOnly protects session cookies from XSS theft. Secure limits it to HTTPS; SameSite limits cross-site sending (CSRF)." },
  { id: "sec_jwt", category: "Security", question: "Who can read a standard (signed) JWT's payload?", options: ["Only the server", "Anyone who has the token", "Nobody without the key", "Only the browser"], answer: 1, explain: "A JWT is signed, not encrypted: the payload is just Base64url. Never put secrets in it. Try it in the JWT Decoder." },
  { id: "css_center", category: "CSS", question: "In a flex row, which centres items vertically?", options: ["justify-content: center", "align-items: center", "text-align: center", "vertical-align: middle"], answer: 1, explain: "justify-content works along the main axis (horizontal in a row); align-items works across it." },
  { id: "css_specificity", category: "CSS", question: "Which selector wins?", code: "#title { color: red }\n.a.b.c.d { color: blue }", options: ["red (#title)", "blue (.a.b.c.d)", "Whichever comes last", "Neither"], answer: 0, explain: "One id beats any number of classes. Specificity is compared as (ids, classes, elements), not added up." },
  { id: "py_is", category: "Python", question: "What does this print?", code: "print([] == [], [] is [])", options: ["True True", "True False", "False False", "False True"], answer: 1, explain: "== compares values; is compares identity. Two new lists are equal but are different objects." },
  { id: "py_default", category: "Python", question: "What is wrong with this?", code: "def add(item, items=[]):\n    items.append(item)\n    return items", options: ["Nothing", "The default list is shared between calls", "append returns None", "Lists cannot be defaults"], answer: 1, explain: "Defaults are evaluated once. Use items=None and create the list inside the function." },
  { id: "docker_cmd", category: "Docker", question: "Which instruction sets a default command that docker run arguments replace?", options: ["RUN", "CMD", "ENTRYPOINT", "EXPOSE"], answer: 1, explain: "RUN runs at build time; ENTRYPOINT is the fixed executable; CMD is the default that docker run args override." },
  { id: "docker_cache", category: "Docker", question: "Why copy package.json and install before COPY . . ?", options: ["It is required", "Layer caching: dependencies are not reinstalled on every code change", "Smaller image", "Security"], answer: 1, explain: "Each instruction is a cached layer. If only your code changed, the install layer is reused and builds take seconds." },
  { id: "vsc_multicursor", category: "VS Code", question: "Add the next match of the selection to a multi-cursor:", options: ["Ctrl/Cmd + D", "Ctrl/Cmd + L", "Alt + Enter", "Ctrl/Cmd + K"], answer: 0, explain: "Press it repeatedly to grab more matches; Ctrl/Cmd + Shift + L selects every match at once." },
  { id: "json_valid", category: "JSON", question: "Which one is valid JSON?", options: ["{a: 1}", "{'a': 1}", "{\"a\": 1}", "{\"a\": 1,}"], answer: 2, explain: "JSON needs double-quoted keys and strings and allows no trailing commas. The JSON Formatter points out exactly where it breaks." },
  { id: "js_eqeq", category: "JavaScript", question: "Which comparison is true?", options: ["null === undefined", "null == undefined", "NaN === NaN", "[] === []"], answer: 1, explain: "Loose == treats null and undefined as equal (and nothing else). NaN never equals itself: use Number.isNaN." }
];

// ---------------------------------------------------------------- tip of the day

export interface DevTip {
  id: string;
  title: string;
  text: string;
  /** The DevSnip Pro command the tip is about; "Try it" runs it. */
  command: string;
  action: string;
}

export const TIP_POINTS = 5;
const PREFIX = "sayaib.hue-console.";

export const TIPS: DevTip[] = [
  { id: "tip_curl", title: "Paste a cURL, get a request", text: "Copied a cURL command from your browser's dev tools? The cURL Converter turns it into fetch, axios, Python or Go code.", command: `${PREFIX}curlConverter`, action: "Open cURL Converter" },
  { id: "tip_jwt", title: "Read any JWT safely", text: "Decode a token's header and payload locally, check its expiry, and verify the signature, without pasting it into a website.", command: `${PREFIX}jwtDecoder`, action: "Open JWT Decoder" },
  { id: "tip_json_types", title: "Types from real JSON", text: "Paste an API response and get TypeScript, Python, Go or Rust types for it in one step.", command: `${PREFIX}jsonToTypes`, action: "Open JSON to Types" },
  { id: "tip_regex", title: "Test a regex with real input", text: "The Regex Tester highlights every match and group live, and the library has ready-made patterns for emails, URLs, dates and more.", command: `${PREFIX}regexLibrary`, action: "Open Regex Tester" },
  { id: "tip_cron", title: "Never guess a cron expression", text: "Write it in plain words or paste an expression to see the next run times, before it fires at 3 a.m. by surprise.", command: `${PREFIX}cronHelper`, action: "Open Cron Helper" },
  { id: "tip_timestamp", title: "Timestamps in every format", text: "Convert Unix seconds or milliseconds, ISO 8601 and your local time zone both ways.", command: `${PREFIX}timestampConverter`, action: "Open Timestamp Converter" },
  { id: "tip_diff", title: "Compare two texts side by side", text: "The Diff Checker shows exactly what changed between two configs, responses or snippets, with no git repo needed.", command: `${PREFIX}textDiff`, action: "Open Diff Checker" },
  { id: "tip_gitignore", title: "A complete .gitignore in seconds", text: "Pick your languages and tools and get a .gitignore that already covers build output, IDE files and secrets.", command: `${PREFIX}gitignoreGenerator`, action: "Open .gitignore Generator" },
  { id: "tip_env", title: "Catch missing environment variables", text: "The .env Checker compares .env with .env.example, so a missing key fails on your machine, not in production.", command: `${PREFIX}envChecker`, action: "Open .env Checker" },
  { id: "tip_security_audit", title: "Scan your workspace for secrets", text: "The Workspace Security Audit finds hard-coded keys, risky patterns and outdated dependencies in a few seconds.", command: `${PREFIX}securityAudit`, action: "Run Security Audit" },
  { id: "tip_mock", title: "Realistic test data on demand", text: "Generate names, emails, addresses and IDs as JSON, CSV or SQL inserts for tests and demos.", command: `${PREFIX}mockDataGenerator`, action: "Open Mock Data Generator" },
  { id: "tip_compose", title: "docker run to Compose", text: "Paste a long docker run command and get the matching docker-compose.yml service.", command: `${PREFIX}dockerRunToCompose`, action: "Open docker run → Compose" },
  { id: "tip_sql_format", title: "Readable SQL in one click", text: "The SQL Formatter tidies a one-line query and the linter flags common mistakes like SELECT * and missing WHERE on UPDATE.", command: `${PREFIX}sparkSqlFormatter`, action: "Open SQL Formatter" },
  { id: "tip_git_recipes", title: "The git command you forgot", text: "Git Command Recipes has the exact commands for undoing, rewording, splitting and recovering, with what each one does.", command: `${PREFIX}gitRecipes`, action: "Open Git Recipes" },
  { id: "tip_hash", title: "Verify a webhook signature", text: "Compute SHA hashes and HMACs, and check Stripe-, GitHub- or Slack-style webhook signatures against a secret.", command: `${PREFIX}hashGenerator`, action: "Open Hash & HMAC" },
  { id: "tip_search", title: "Every tool is one search away", text: "Search All Tools finds any of DevSnip Pro's tools by name or by what you want to do, like \"decode\" or \"docker\".", command: `${PREFIX}searchTools`, action: "Search all tools" },
  { id: "tip_snippet", title: "Save the code you type every week", text: "Turn a selection into a snippet with a prefix, then insert it anywhere by typing the prefix.", command: `${PREFIX}createCustomSnippet`, action: "Create a snippet" }
];

// ---------------------------------------------------------------- spin wheel

export type WheelPrize = { points: number } | { freeze: true } | { item: true };

export interface WheelSegment {
  id: string;
  label: string;
  icon: string;
  /** Relative chance. */
  weight: number;
  prize: WheelPrize;
  color: string;
}

export const WHEEL: WheelSegment[] = [
  { id: "p5", label: "+5", icon: "🪙", weight: 26, prize: { points: 5 }, color: "#4cc9f0" },
  { id: "p10", label: "+10", icon: "💰", weight: 24, prize: { points: 10 }, color: "#06d6a0" },
  { id: "freeze", label: "Freeze", icon: "❄️", weight: 6, prize: { freeze: true }, color: "#118ab2" },
  { id: "p15", label: "+15", icon: "💎", weight: 18, prize: { points: 15 }, color: "#c77dff" },
  { id: "p25", label: "+25", icon: "🌟", weight: 12, prize: { points: 25 }, color: "#ff9f1c" },
  { id: "item", label: "Item", icon: "🎁", weight: 4, prize: { item: true }, color: "#ef476f" },
  { id: "p50", label: "+50", icon: "👑", weight: 4, prize: { points: 50 }, color: "#ffd166" },
  { id: "p10b", label: "+10", icon: "💰", weight: 6, prize: { points: 10 }, color: "#06d6a0" }
];

/** Points paid instead when a freeze or item cannot be given (full, or nothing left). */
export const WHEEL_FALLBACK_POINTS = 25;

export function spinWheel(random: () => number = Math.random): number {
  const total = WHEEL.reduce((sum, segment) => sum + segment.weight, 0);
  let roll = Math.max(0, Math.min(0.999999, random())) * total;
  for (let i = 0; i < WHEEL.length; i++) {
    roll -= WHEEL[i].weight;
    if (roll < 0) return i;
  }
  return WHEEL.length - 1;
}

// ---------------------------------------------------------------- Bit Sprint

/** Points for the day's first Bit Sprint: one per correct answer, up to this. */
export const SPRINT_MAX_POINTS = 10;
export const SPRINT_SECONDS = 30;
/** No one answers more than this in 30 seconds; higher scores are clamped. */
export const SPRINT_MAX_SCORE = 40;

export function sprintPoints(score: number): number {
  return Math.max(0, Math.min(SPRINT_MAX_POINTS, Math.trunc(score)));
}

// ---------------------------------------------------------------- weekly events

export interface WeeklyEvent {
  id: string;
  title: string;
  icon: string;
  description: string;
  target: number;
  points: number;
  /** The exclusive reward (REWARDS id), only won during this event. */
  rewardId: string;
  step: (run: ToolRunEvent) => number;
}

export const WEEKLY_EVENTS: WeeklyEvent[] = [
  { id: "security_week", title: "Security Week", icon: "🛡️", description: "Run 5 security scans or audits", target: 5, points: 80, rewardId: "frame_shield", step: run => (run.category === "Security" ? 1 : 0) },
  { id: "ai_week", title: "AI Week", icon: "🤖", description: "Run 8 AI, ML or prompt tools", target: 8, points: 80, rewardId: "banner_neural", step: run => (run.category === "AI" ? 1 : 0) },
  { id: "explorer_week", title: "Explorer Week", icon: "🧭", description: "Use 8 different tools this week", target: 8, points: 80, rewardId: "avatar_astronaut", step: run => (run.newThisWeek ? 1 : 0) },
  { id: "snippet_week", title: "Snippet Week", icon: "📝", description: "Create or use snippets 4 times", target: 4, points: 80, rewardId: "title_snippet_smith", step: run => (run.category === "Snippets" ? 1 : 0) },
  { id: "api_week", title: "API Week", icon: "🌐", description: "Open the REST API Client 5 times", target: 5, points: 80, rewardId: "avatar_satellite", step: run => (run.command === `${PREFIX}openGUI` ? 1 : 0) },
  { id: "marathon_week", title: "Marathon Week", icon: "🏃", description: "Run 40 tools this week", target: 40, points: 100, rewardId: "title_marathoner", step: () => 1 }
];

/** Whole weeks between two Monday dates. */
function weekNumber(weekStart: string): number {
  const time = Date.parse(`${weekStart}T00:00:00Z`);
  return Number.isFinite(time) ? Math.floor(time / (7 * 86400000)) : 0;
}

/** The event running in the week that starts on `weekStart` (a Monday). Rotates through every event. */
export function eventForWeek(weekStart: string): WeeklyEvent {
  const index = ((weekNumber(weekStart) % WEEKLY_EVENTS.length) + WEEKLY_EVENTS.length) % WEEKLY_EVENTS.length;
  return WEEKLY_EVENTS[index];
}

export function findEvent(id: string): WeeklyEvent | undefined {
  return WEEKLY_EVENTS.find(event => event.id === id);
}

// ---------------------------------------------------------------- check-ins and lucky finds

/** Every 7th day of a streak opens the weekly check-in chest. */
export const CHECKIN_CHEST_EVERY = 7;
/** Paid instead of an item when there is nothing left to give. */
export const CHECKIN_CHEST_POINTS = 50;

/** Chance that a tool run is a lucky find, at most once a day. */
export const LUCKY_CHANCE = 0.05;
export const LUCKY_POINTS = 10;

// ---------------------------------------------------------------- daily picks

/** Small string hash for picking the day's question and tip. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same question for a date everywhere, cycling through the bank before repeating. */
export function quizForDate(date: string): QuizQuestion {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) || 0;
  const cycle = Math.floor(day / QUIZ_BANK.length);
  // Shuffle each cycle's order so neighbouring days are not neighbouring entries.
  const order = QUIZ_BANK.map((_, i) => i).sort((a, b) => hash(`${cycle}:${a}`) - hash(`${cycle}:${b}`));
  return QUIZ_BANK[order[((day % QUIZ_BANK.length) + QUIZ_BANK.length) % QUIZ_BANK.length]];
}

export function tipForDate(date: string): DevTip {
  return TIPS[hash(`tip:${date}`) % TIPS.length];
}

export function findQuiz(id: string): QuizQuestion | undefined {
  return QUIZ_BANK.find(question => question.id === id);
}

export function findTip(id: string): DevTip | undefined {
  return TIPS.find(tip => tip.id === id);
}
