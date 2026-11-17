# What the page exports (Steps 4 and 5)

## The six files
All go into `<project>/design/`, with exactly these names. No other name is ever valid.

| File | What it is |
|---|---|
| `identity.json` | The source: every other file is generated from it |
| `DESIGN.md` | The rules coding agents follow (Google design.md format) |
| `tokens.json` | The values as W3C Design Tokens |
| `tokens.css` | The values as CSS variables, light and dark |
| `theme.css` | Ready-made styles for buttons, cards and text |
| `style-guide.html` | A page that shows the identity (not in pasted text: too long; it comes from the server or the download) |

## Tier 1: the save server
The server writes the files itself and prints one JSON line per event:
- `{"status":"ready","url":"…","existing":[…],"replace":false,"port":47821,"fallback":false}` when it starts.
- `{"status":"saved","written":["identity.json", …]}` when the user exported. The files are in place.
- `{"status":"closed","reason":"…"}` when it stopped without saving (idle timeout, too many wrong tokens, error).

## Tier 2: the page in your browser tool
When the user presses «تصدير», the page sets `document.documentElement.dataset.hawiyaExport` to `"ready"`
(`"stale"` once they change something after exporting) and `window.hawiyaExport` to:
```json
{ "format": "hawiya-export", "schemaVersion": 1, "files": { "identity.json": "…", "DESIGN.md": "…" } }
```
Keys of `files` are bare file names; values are the full text of each file. Other keys may be present: ignore them.

## Tier 3: text pasted by the user («انسخ للوكيل»)
A few lines of instructions, then each file between two marker lines:
```
===== HAWIYA FILE: design/DESIGN.md =====
…the file, line by line…
===== HAWIYA END FILE =====
```
A file's content is every line after its start marker up to (not including) the end marker. Each file ends with
one newline. Keep it byte for byte: no trimming, no reformatting, no added text.
Ask the user to copy again (never repair it yourself) when a marker is missing, a name is not one of the six, the
text looks cut off, or `identity.json` does not parse as JSON.

## The download («تنزيل»)
`hawiya-design.zip` holds a `design/` folder with all six files. The user unzips it into the project root.
