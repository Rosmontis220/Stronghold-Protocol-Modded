# PACKS.md — content packs

A **content pack** is add-on content a server picks up from a folder: a manifest plus its files. The owner's decision of
2026-10-07 made the language pack the first type of one general mechanism, so that later resource packs (art, audio,
fonts) and server-side data packs reuse the same manifest, registry and index instead of each inventing its own. The
mechanism is kept although the i18n layer was removed ([D015](development/DECISIONS.md#d015)): **`lang`** is still
validated and listed, but no client consumes it and none ships — the built-in language folders are gone and the game is
Simplified Chinese only. `assets` and `data` remain planned.

| File | Role |
|---|---|
| `shared/packs.js` | the format: the manifest, the pack types (`PACK_TYPES`), app version ranges, the index (browser, server and tools) |
| `shared/i18nPacks.js` | the `lang` type: language codes, the language fields, the fallback chain, the script family |
| `server/packs.js` | the registry: discovery, validation, the index, which pack files may be served |
| `server/http/static.js` | `GET /packs/index.json` (the live index) and `GET /packs/<id>/<file>` |
| `tools/packs.mjs` | `list`, `index` (the index file for a static host), `check` |
| `tools/package.mjs` | ships the committed packs and writes `packs/index.json` into the release zips |

There is no client-side loader any more: the module that read a `lang` entry and drew the language menu
(`public/js/ui/lang.js`) went with the i18n layer.

## 1. Layouts

Two layouts, read by the same registry and listed alike:

```
packs/<id>/pack.json + its files        a folder pack — any type; the manifest names its files
i18n/<code>.json in the public tree     a single-file language pack — its manifest is the file's `_meta` block
i18n/<code>.json in the data tree         (+ its game texts, when present)
```

The built-in language folders no longer ship (the i18n layer was removed, [D015](development/DECISIONS.md#d015)), so only
a folder pack provides a language now; the registry still reads both layouts, so a single file dropped back into a
language folder would be picked up. The folder is the layout every pack type shares — a pack distributed as one folder
with its own readme and licence, and the only layout a resource or data pack will have.

The id of a folder pack is its folder name; the id of a single-file language pack is its language code. Ids are
letters, digits, `.`, `_` and `-` (at most 64), unique across types and without regard to case (Windows and macOS
would see one folder).

## 2. The manifest

`packs/<id>/pack.json`, or the `_meta` block of a single-file language pack (the same fields):

```json
{
  "type": "lang",
  "lang": "ja",
  "name": "日本語",
  "englishName": "Japanese",
  "version": "1.0.0",
  "app": ">=0.2.0",
  "authors": ["…"],
  "credits": "…",
  "license": "CC-BY-4.0",
  "fallback": ["en"],
  "files": { "ui": "ui.json", "data": "data.json" }
}
```

| Field | Meaning |
|---|---|
| `id` | optional: the folder or file name decides; a manifest that names another id gets a warning |
| `type` | `lang` (a single-file language pack may leave it out); planned: `assets`, `data` |
| `version` | the pack's own version |
| `app` | the app versions it is made for, a range: `>=0.2.0`, `>=0.2.0 <0.3.0`, `0.2.x`, `^0.2.0`, `~0.2.1`, `*`, alternatives with `||`. A pre-release (0.2.0-dev) counts as its release. Outside the range a language pack is flagged `compatible: false` (the server log, `tools/packs.mjs list`); a later type decides what an incompatible pack means for it |
| `name`, `englishName` | the name in its own language (a language pack: the language's own name) and in English |
| `authors`, `credits`, `license` | who made it; free text (`license`: an SPDX id or text) |
| `files` | a folder pack: role → path inside the folder. Each type lists its roles and their extensions (`lang`: `ui` required, `data` optional, both `.json`) |
| the type's fields | `lang`: `lang`, `base`, `fallback`, `complete`, `machineTranslated`, `numberUnits` (`shared/i18nPacks.js`) |
| `machineTranslated` | `lang`, optional: `true` when the pack's UI strings come from a machine (a translation, or a conversion such as the Traditional Chinese pack's). The index entry carries it (only when true, like `complete`). A value other than `true` / `false` is a warning and reads as false |

A **problem** keeps a pack from loading (unknown type, no `lang`, a file missing or outside the folder, broken JSON, an
id or a language already taken — the language folders' files come first, then the folders by id); a **warning** does
not (an id that differs, an app range this version is outside of, an unknown file role). Both are printed when the
server starts or notices a change, and by `node tools/packs.mjs list`.

## 3. Discovery and the index

The server's registry (`server/packs.js`) scans the two language folders and `packs/` when it starts and again whenever
something there changes: on a request for the index or a pack file it compares the names, sizes and times of the files it
reads (at most once a second, a few `stat` calls) and scans again if they differ. A pack dropped into a folder is picked
up — no restart, no build step.

`GET /packs/index.json` (never cached) answers the packs of supported types:

```json
{ "version": 1, "app": "0.2.0", "packs": [
  { "id": "qaa", "type": "lang", "name": "Qaa", "englishName": "Qaa", "version": "1.0.0", "app": ">=0.2.0",
    "compatible": true, "authors": ["…"], "lang": "qaa", "fallback": ["en"], "complete": false, "strings": 1017,
    "files": { "ui": "/packs/qaa/ui.json", "data": "/packs/qaa/data.json" } } ] }
```

`files` holds URLs on this server, so a client never builds a path itself. A client reads the entries of its type
(`readPackIndex(json, 'lang')`: an entry of another type, with a bad id or a URL that is not a path on this server is
dropped) — no shipped client does any more, the registry and the tools are what read the index.

**A static host** cannot list folders: `node tools/packs.mjs index` writes the same body to `packs/index.json`
(git-ignored), and `tools/package.mjs` writes it into the release zips. The live server answers `/packs/index.json`
itself and ignores that file. Serving the game from plain files needs the server's URL layout: `public/` at `/`,
`data/` at `/data/`, `shared/` at `/shared/`, `server/sim/` at `/sim/` and `packs/` at `/packs/` (the game itself still
needs the Node server for its rooms; DEPLOY.md).

**What is served.** `GET /packs/<id>/<file>` answers only a file that the manifest of a loaded folder pack names under a
role of its type, with that role's extension, inside the folder once links are resolved — `pack.json`, a readme, an
HTML or script file in the folder are never served; a pack of a planned type serves nothing. A single-file language
pack's files are the language folders' own (the `i18n/<code>.json` of the public tree, plus the game texts under the
data tree's `i18n/`).

## 4. The types

| Type | Status | Where it applies | Loader |
|---|---|---|---|
| `lang` | supported (0.2.0) | nothing loads it since the i18n layer was removed ([D015](development/DECISIONS.md#d015)) | none — the former client (`public/js/ui/lang.js`) is gone |
| `assets` | planned | the client: art, audio, font replacements | — |
| `data` | planned | the server: data patches applied at start | — |

A pack of a planned type is parsed and listed as not supported ("type "assets" is planned …, not loaded by this
version"); it is never served and never changes anything.

### Adding a pack type

1. **The type** — its entry in `PACK_TYPES` (`shared/packs.js`): `status`, `summary`, `live` (whether a running server
   may take changes without a restart) and `files` (the roles a folder pack names, with the extensions that may be
   served for each). Its own manifest fields get a normalizer beside `langFields` and a branch in `normalizeManifest`;
   its index fields a branch in `packIndexEntry`.
2. **The loader** — reads the registry by type: `createPackRegistry(…).list('assets')` on the server, or the index
   entries of the type in the browser (`readPackIndex(json, 'assets')`). A
   server-side type (`data`) loads once at start (`live: false`): the simulation's code and data are fixed for the life
   of the process, and a battle must run the same data on the server and in every browser.
3. **The checks** — what `tools/packs.mjs check` and the tests verify for the type (a data pack: the same validation
   the data builder applies; a resource pack: the files exist and are of the allowed kinds), and its documentation
   here.

Things later types must keep (the maintainers' study of mods, 2026-10-07):

- **Server-side only for gameplay.** A data pack is installed on the server, so every player of a room uses the same
  content and the server can still check or recompute a battle. A player never installs gameplay content of their own.
- **A content hash in the handshake** before data packs ship (`welcome`, `/healthz`, the BattleSpec), so a client and
  a server can tell they run the same content, and a "modded" mark in the UI and in bug reports.
- **No third-party code.** The manifest and its files are data (JSON, images, audio, fonts); a pack type that runs code
  is a separate decision of the owner's.
- **The golden results stay on the original content**; a pack never changes them.

## 5. Tools

```
node tools/packs.mjs list [--json]          the packs by type, what was skipped and why, the warnings
node tools/packs.mjs index [--out <file>]   write packs/index.json (the static index)
node tools/packs.mjs check [--strict]       list; --strict exits 1 when a pack is skipped or warned about
```

`--root <dir>` points `tools/packs.mjs` at another checkout or an unpacked release.

## 6. Shipping

`tools/package.mjs` ships the committed packs (`packs/`, and a language file if one is put back into a language folder —
tracked files only: a pack installed on this machine and not committed stays out) and writes `packs/index.json` into the
stage from the packs that ship. `test/package.test.js` checks both layouts and that a local pack stays out.

## Tests

The registry's own tests went with the i18n layer. What covers packs now is the shipping side: `test/package.test.js`
(both layouts ship, a pack only on this machine does not, the generated `packs/index.json` lists exactly them) and the
update tests `test/update-boot.test.js` / `test/update-package.test.js` (a player's own pack survives an update).
