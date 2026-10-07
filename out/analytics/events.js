"use strict";
/**
 * The analytics event catalog: the single source of truth for every event
 * DevSnip Pro can send, its properties, and their documentation.
 *
 * Adding an event is one entry here. `track()` is typed from this object, the
 * client validates every property against it at runtime (anything not listed
 * is dropped), and docs/ANALYTICS.md is checked against it by a unit test.
 *
 * Naming: events are `object_past_tense_verb` in snake_case
 * (`snippet_created`, `tool_search_performed`). Properties are snake_case.
 *
 * Privacy: there is deliberately no free-text property kind. Every value is a
 * number, a boolean, an enum, or a short identifier matched by a strict
 * pattern, so file paths, snippet contents, search queries, URLs and names
 * cannot be sent even by mistake.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_INTERACTION_EVENTS = exports.EVENT_CATALOG = void 0;
/** Checks the catalog's shape while keeping its literal types (works on any TypeScript 4.x). */
function defineCatalog(catalog) {
    return catalog;
}
exports.EVENT_CATALOG = defineCatalog({
    // Lifecycle -----------------------------------------------------------------
    extension_activated: {
        description: "The extension started in a VS Code window.",
        properties: {
            first_run: { kind: "bool", description: "First activation for a brand-new installation. False for users who had DevSnip Pro before analytics existed." },
            install_type: { kind: "enum:new|updated|returning", description: "new: first ever activation; updated: first activation after a version change (including the first version with analytics); returning: same version as last time." },
            activation_ms: { kind: "ms", description: "Time activate() took." },
            ui_kind: { kind: "enum:desktop|web", description: "VS Code desktop or VS Code for the web." },
            remote: { kind: "bool", description: "Running in a remote (SSH, WSL, container, Codespaces) window." },
            locale: { kind: "id", description: "VS Code display language, e.g. en or de." }
        }
    },
    extension_updated: {
        description: "First activation after DevSnip Pro was updated to a new version.",
        properties: {
            previous_version: { kind: "version", description: "Version used before the update. Absent when updating from a version that predates analytics." }
        }
    },
    session_started: {
        description: "A usage session began: on activation, or on the first interaction after 30 minutes idle.",
        properties: {
            reason: { kind: "enum:activation|resumed", description: "Why the session started." }
        }
    },
    session_ended: {
        description: "A usage session ended: after 30 minutes without interaction, when VS Code closed, or (reported on the next start) after a crash.",
        properties: {
            reason: { kind: "enum:idle|shutdown|interrupted", description: "idle: 30 minutes without interaction; shutdown: VS Code closed; interrupted: VS Code crashed or was force-quit (reported on the next start)." },
            duration_s: { kind: "seconds", description: "From session start to the last interaction." },
            engaged_s: { kind: "seconds", description: "Sum of gaps of 5 minutes or less between DevSnip Pro interactions." },
            interaction_count: { kind: "count", description: "Tracked interactions in the session." },
            feature_count: { kind: "count", description: "Distinct features used in the session." }
        }
    },
    // Every command -------------------------------------------------------------
    feature_used: {
        description: "A DevSnip Pro command ran, from any surface (palette, tool tree, hub card, context menu, keybinding).",
        properties: {
            feature: { kind: "id", description: "Command id without the extension prefix, e.g. jsonFormatter." },
            category: { kind: "id", description: "Feature area: the navigation section (api, frontend, mobile, code, text, convert, database, testing, git, devops, security, ai, data), or navigation, progress, core." },
            outcome: { kind: "enum:success|error", description: "Whether the command handler completed without throwing." },
            duration_ms: { kind: "ms", description: "Time the command handler took (opening a panel, running a scan...)." },
            first_use: { kind: "bool", description: "First time this installation used this feature." }
        }
    },
    // Tool search ---------------------------------------------------------------
    tool_search_performed: {
        description: "The user searched the tool list. The query itself is never sent.",
        properties: {
            query_length: { kind: "count", description: "Length of the search pattern in characters." },
            match_count: { kind: "count", description: "Tools matched." },
            invalid_pattern: { kind: "bool", description: "The pattern was not a valid regular expression." }
        }
    },
    tool_search_selected: {
        description: "A tool was opened from search results.",
        properties: {
            feature: { kind: "id", description: "Command id of the chosen tool, without prefix." },
            rank: { kind: "count", description: "1-based position in the results." }
        }
    },
    // Snippets ------------------------------------------------------------------
    snippet_created: {
        description: "A custom snippet was saved. Its name, prefix and code are never sent.",
        properties: {
            language: { kind: "id", description: "VS Code language id, e.g. typescript." },
            line_count: { kind: "count", description: "Lines in the snippet body." },
            overwrote: { kind: "bool", description: "It replaced a snippet with the same name." }
        }
    },
    snippet_deleted: {
        description: "A custom snippet was deleted.",
        properties: {
            language: { kind: "id", description: "VS Code language id." }
        }
    },
    // REST API client -----------------------------------------------------------
    request_saved: {
        description: "A REST client request was saved to a collection. The URL and body are never sent.",
        properties: {
            updated: { kind: "bool", description: "It updated an existing saved request rather than adding one." },
            collection_size: { kind: "count", description: "Saved requests after the save." }
        }
    },
    request_deleted: {
        description: "A saved REST client request was deleted.",
        properties: {
            collection_size: { kind: "count", description: "Saved requests after the delete." }
        }
    },
    // README manager ------------------------------------------------------------
    readme_saved: {
        description: "A README was saved from the README manager.",
        properties: {}
    },
    readme_deleted: {
        description: "A README was deleted from the README manager.",
        properties: {}
    },
    // Copying -------------------------------------------------------------------
    content_copied: {
        description: "The user copied generated content (a command, code...) to the clipboard. The content is never sent.",
        properties: {
            feature: { kind: "id", description: "Feature the copy came from." },
            kind: { kind: "id", description: "What was copied, e.g. install_command, update_command." }
        }
    },
    // Toolkit tools --------------------
    tool_run_completed: {
        description: "A toolkit tool produced a result or an error. Inputs and outputs are never sent.",
        properties: {
            feature: { kind: "id", description: "Command id of the tool, without prefix, e.g. dockerfileHelper." },
            section: { kind: "enum:api|frontend|mobile|code|text|convert|database|testing|git|devops|security|ai|data", description: "Navigation section of the tool (layout.ts)." },
            outcome: { kind: "enum:success|input_error|error|timeout", description: "success: a result; input_error: the tool asked for different input; error: an unexpected failure; timeout: no result within 90 seconds." },
            trigger: { kind: "enum:run|live|preset|action", description: "run: the Run button or Ctrl/Cmd+Enter; live: automatic re-run while typing (only the first per panel is sent); preset: a preset was applied; action: a tool-specific button such as Detect from workspace." },
            duration_ms: { kind: "ms", description: "Time the tool took." }
        }
    },
    tool_output_used: {
        description: "The user did something with a toolkit tool's output. The output itself is never sent.",
        properties: {
            feature: { kind: "id", description: "Command id of the tool, without prefix." },
            action: { kind: "enum:copy|insert|open|save|write_all", description: "copy: to clipboard; insert: at the editor cursor; open: as a new editor; save: one file to the workspace; write_all: every generated file." },
            file_count: { kind: "count", description: "Files written (save and write_all only)." }
        }
    },
    // Dependencies & Installation ----------------------------------------------
    dependency_scan_completed: {
        description: "The Dependencies & Installation panel finished a scan.",
        properties: {
            project_count: { kind: "count", description: "Projects detected." },
            dependency_count: { kind: "count", description: "Dependencies listed." },
            ecosystems: { kind: "id_list", description: "Ecosystems present: node, python, maven, gradle." },
            managers: { kind: "id_list", description: "Package managers present: npm, yarn, pnpm, pip, maven, gradle." },
            missing_count: { kind: "count", description: "Missing or wrong-version dependencies." },
            outdated_count: { kind: "count", description: "Dependencies with an in-range update." },
            major_count: { kind: "count", description: "Dependencies with a newer major / out-of-range version." },
            duration_ms: { kind: "ms", description: "Scan time including registry lookups." }
        }
    },
    dependency_job_finished: {
        description: "An install or update run from the Dependencies panel finished, failed, or was declined.",
        properties: {
            action: { kind: "enum:install_missing|update_outdated|install|update|upgrade", description: "What was run." },
            outcome: { kind: "enum:success|error|cancelled|declined|blocked", description: "How it ended." },
            ecosystems: { kind: "id_list", description: "Ecosystems involved." },
            step_count: { kind: "count", description: "Commands in the job." },
            duration_ms: { kind: "ms", description: "Run time, excluding the confirmation dialog." }
        }
    },
    // Points and milestones -----------------------------------------------------
    milestone_unlocked: {
        description: "The user reached a milestone.",
        properties: {
            milestone: { kind: "id", description: "Milestone id, e.g. tool_explorer." }
        }
    },
    level_reached: {
        description: "The user reached a new level.",
        properties: {
            level: { kind: "id", description: "Level name, e.g. Silver." },
            level_index: { kind: "count", description: "0-based level index." }
        }
    },
    daily_bonus_claimed: {
        description: "The daily boost was claimed in the Milestones & Points panel.",
        properties: {}
    },
    points_spent: {
        description: "Points were spent: on a premium REST client tool, a streak freeze or a reward unlocked early.",
        properties: {
            amount: { kind: "count", description: "Points spent." }
        }
    },
    quest_completed: {
        description: "One of the day's quests was finished.",
        properties: {
            quest: { kind: "id", description: "Quest id, e.g. new_tool." }
        }
    },
    quests_all_done: {
        description: "Every quest of the day was finished and the bonus chest paid out.",
        properties: {}
    },
    reward_unlocked: {
        description: "A reward (a theme or a badge frame) was unlocked.",
        properties: {
            reward: { kind: "id", description: "Reward id, e.g. theme_synthwave." },
            via: { kind: "enum:level|milestone|points|kept", description: "Earned by rank, earned by a milestone, bought with points, or kept free because it was in use when themes became paid." }
        }
    },
    streak_freeze: {
        description: "A streak freeze was earned, bought or used up to save a streak.",
        properties: {
            action: { kind: "enum:earned|bought|used", description: "What happened." },
            count: { kind: "count", description: "Freezes involved." }
        }
    },
    theme_preview: {
        description: "A locked theme was tried for a short while, and how the preview ended.",
        properties: {
            theme: { kind: "id", description: "Theme id, e.g. dracula." },
            outcome: { kind: "enum:started|unlocked|ended|expired|replaced", description: "started when it begins; then unlocked (bought), ended (stopped early), expired (time ran out) or replaced (another theme chosen)." }
        }
    },
    weekly_recap: {
        description: "The once-a-week recap notification was shown, or opened.",
        properties: {
            action: { kind: "enum:shown|opened", description: "What happened." }
        }
    },
    // Activation and onboarding -------------------------------------------------
    activation_milestone: {
        description: "A core first-time action happened. Sent once per installation per milestone, to learn which first steps lead to lasting use.",
        properties: {
            milestone: { kind: "enum:first_launch|first_tool|first_api_request|first_snippet|first_ai_tool|first_security_scan|first_database_connection|first_opencode", description: "Which first: a request actually sent, a scan completed, a database connected - not just a panel opened." },
            days_since_install: { kind: "count", description: "Whole days between the first launch and this milestone." }
        }
    },
    onboarding_action: {
        description: "The user interacted with the in-product onboarding (the sidebar Getting started card, the walkthrough or What's new).",
        properties: {
            action: { kind: "enum:step_opened|guide_dismissed|walkthrough_opened|whats_new_opened|whats_new_dismissed", description: "What was done." },
            step: { kind: "id", description: "For step_opened: the checklist step, e.g. first_api_request." }
        }
    }
});
/** Events that are bookkeeping rather than user interaction (they do not extend a session). */
exports.NON_INTERACTION_EVENTS = new Set(["session_started", "session_ended"]);
//# sourceMappingURL=events.js.map