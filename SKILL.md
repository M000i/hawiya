---
name: hawiya
description: >
  Let the user pick their app's visual UI identity (colors, fonts, corners) by eye in a local
  picker page, then save it into the project's design/ folder (DESIGN.md, identity.json, ...) so every
  coding agent follows it. Use after the app idea is clear and before building its screens, or when the
  user asks to choose, change or redo the look, theme, design system or "هوية الواجهة". Arabic-first.
---

# Hawiya — choose the UI identity

You do NOT design the UI yourself here. The user chooses in the picker page; you prepare, open, wait, then save.
When: the app idea is clear and its screens are not built yet, or the user asks to choose or change the look.
`<skill>` = the folder containing this SKILL.md. `<project>` = the user's project root. Quote both paths in
commands (they may contain spaces). Details live in `<skill>/references/`: read the file a step names.

## Hard rules
- Never read or list `<skill>/library/`. The page does the matching.
- Write only inside `<project>/design/`, plus the one commit line of Step 6 in `CLAUDE.md` and/or `AGENTS.md`.
  Change no other file.
- The output files are: identity.json, DESIGN.md, tokens.json, tokens.css, theme.css, style-guide.html.
  Never overwrite or delete any of them in `<project>/design/` without the user's explicit yes (Step 2).
- The picker URL contains a one-time token: give it to the user, but never write it into project files or commits.
- Talk to the user in their language (Arabic if they write Arabic).

## Step 1 — Read the project
Follow `references/project-detection.md`. Read only what you need: README, the dependency file (package.json,
pubspec.yaml, ...), the main page or layout file, existing CSS/theme files. Decide:
- type: one of `landing`, `website`, `web-app`, `dashboard`, `html-page` (if it is mainly charts/tables,
  `dashboard`; any other interactive app, `web-app`). Desktop/mobile apps: say only web is supported for
  now and use the closest web type.
- language: `ar`, `en` or `ar+en` (from content, `lang`/`dir`, i18n folders; ask if unclear).
- brand colors: up to 3 existing brand/primary colors as lowercase `#rrggbb` (convert rgb/hsl), or none.
- tags (1–3) and the elements that suit the platform: `references/platforms.md` (web: all eleven).

## Step 2 — Existing identity
If `<project>/design` exists but is not a plain folder (a symlink/shortcut or a file), stop: tell the user and
write nothing. If `<project>/design/` contains any of the six output files, list them and ask whether to replace them.
- User says no → stop the whole skill; write nothing.
- User says yes → move those files (never delete) into `<project>/design/backup-<YYYYMMDD-HHMMSS>/`
  (local time), then continue.

## Step 3 — Session file
Write `<project>/design/hawiya-session.json` (create `design/` if needed; overwriting an older session file is
fine, but if it is a symlink, delete only the link first — never write through a link).
Shape only — fill in YOUR Step 1 results, never copy these example values:
```json
{ "type": "dashboard", "language": "ar+en", "tags": ["corporate"], "brandColors": ["#7c3aed"], "platform": "web",
  "elements": ["colors", "modes", "fonts", "type-scale", "radius", "shadows", "icons", "buttons", "cards", "spacing", "direction"] }
```
Leave `brandColors` out when there are none. Only the values listed here and in the references are valid.
`tags`: 1–3 words for the wanted feel, from: minimal, corporate, editorial, playful, luxury, glass, brutalist,
neumorphic, retro, material, cupertino, fluent, technical, data-dense, vivid, soft.
The picker reads it to steer its suggestions: through the server in Tier 1, from the link in Tier 2.

## Step 4 — Open the picker (go down the tiers until one works)

**Tier 1 — local save server (preferred).** Use Node if `node -v` is 18+, else Python if `python3 --version` is 3.8+:
- `node "<skill>/scripts/serve.js" "<project>"`
- `python3 -I "<skill>/scripts/serve.py" "<project>"`

Start it as a background process whose output goes to a temporary file OUTSIDE `<project>` (e.g. in the
system temp folder; the output contains the token). Then, in one command, check that file every 0.5 s for up
to 10 s until it has a first line (e.g. `for i in $(seq 1 20); do [ -s "$F" ] && break; sleep 0.5; done; head -1 "$F"`).
Some agents (e.g. Codex) stop every process a command started when that command ends, even with `&` or
`nohup`. Then run the server command itself, in the foreground, as a long-running command you can keep reading
(Codex: one exec_command; read its output by polling that same session) instead of a background process.
Right after the ready line, check that the server still runs (e.g. `kill -0 <pid>`); if not, use that way.
That line is JSON: `{"status":"ready","url":"http://127.0.0.1:47821/#token=…&project=…","existing":[…],"port":47821,"fallback":false}`
(`existing` lists only output files already in design/; after Step 2 it should be empty — if not, stop the
process and go back to Step 2). No such line within 10 seconds, or the process exits → try the other runtime,
then Tier 2/3. If `"fallback":true` (port 47821 was busy, usually by an earlier Hawiya run that has not timed
out yet), carry on, and tell the user that their saved identities from earlier sessions are not shown this time.
Open the URL in the user's default browser (`open "<url>"` macOS, `xdg-open "<url>"` Linux,
`start "" "<url>"` Windows) and show it in the chat: "اختر ما يعجبك ثم اضغط «تصدير»".
Then wait for the process to exit. If your environment tells you when a background command finishes, end your
turn and wait for that; otherwise wait on the process with a long timeout. While you wait, watch the process
itself, not only its output: it may end without writing a last line. It closes itself 60 minutes after
the last activity. If the user cancels in chat, stop the process and end the skill. If instead the user pastes
a Hawiya export in chat (the page offers this when saving fails), stop the process and go to Step 5 with that
text. Otherwise, the server's last output line is the outcome:
- `{"status":"saved","written":[…]}` → the files are already in `<project>/design/`. Go to Step 6.
- `{"status":"closed","reason":…}`, or the process ended without either line → nothing was saved. Tell the
  user, offer Tier 3 (or Tier 2 if you have such a browser), and end the skill if they decline.

**Tier 2 — your browser tool can open local files AND run JavaScript in them** (e.g. Playwright, Chrome
DevTools). Tested: the Claude desktop browser pane shows `file://` pages as a static snapshot without running
their scripts, and Claude in Chrome cannot navigate to `file://` at all — with those, skip to Tier 3.
Open `file://<skill>/picker/index.html#session=<B64>` (encode spaces as `%20`); `<B64>` is the session file in
base64 on one line: `base64 < "<project>/design/hawiya-session.json" | tr -d '\n'`. Ask the user to choose,
press «تصدير», and tell you when done. Then check `document.documentElement.dataset.hawiyaExport === "ready"` (`"stale"` = they
changed something after exporting: ask them to press «تصدير» again) and read `window.hawiyaExport`, an object
`{"format":"hawiya-export","schemaVersion":1,"files":{"DESIGN.md":"…", …}}` (keys are bare file names).
Go to Step 5 with `files`.

**Tier 3 — anything else.** Ask the user to double-click `<skill>/picker/index.html`, choose, press «تصدير»,
then «انسخ للوكيل», and paste the result in the chat. Go to Step 5 with the pasted text. The pasted text
leaves out `style-guide.html`: if the user also wants it, they press «تنزيل» and unzip `hawiya-design.zip`
into the project root (it holds a `design/` folder with all six files).

## Step 5 — Save the files (Tiers 2 and 3 only)
The formats are in `references/export-format.md`. Write each file into `<project>/design/` exactly as given:
same name, same content, UTF-8, LF line endings,
nothing added, removed or reformatted. In pasted text, a file's content is every line after its
`===== HAWIYA FILE: design/<name> =====` line up to (not including) the `===== HAWIYA END FILE =====` line;
each file ends with one newline. Only the six output names are allowed. If a marker is missing, a name is
unknown, or anything looks cut off, ask the user to copy again instead of guessing. Check that `identity.json`
parses as JSON; if it does not, ask the user to copy again (do not fix it yourself).

## Step 6 — Commit line and summary
Add this exact line at the end of `CLAUDE.md` and of `AGENTS.md` — each one that exists — unless that
file already has a line containing `Follow design/DESIGN.md` (that text is the marker: then add nothing, so
running the skill again never repeats the line). If neither exists, create the one your own agent reads
(`CLAUDE.md` for Claude Code, otherwise `AGENTS.md`) with just this line:

`- Follow design/DESIGN.md for all UI work (colors, fonts, corners, components). التزم بـ design/DESIGN.md.`

Add it as a new last line (put a line break before it if the file does not end with one); change nothing else.

Confirm the saved files exist in `<project>/design/` (if any is missing, say so plainly and do not claim
success). Then tell the user in two or three short lines which files were saved and the chosen primary color,
font and corner radius (from `design/identity.json`: `tokens.color.light.primary`, `tokens.font.body.arabic`
or `.latin`, and `tokens.radius.md`, a number in px), and that future UI work will follow it.
