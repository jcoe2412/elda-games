# elda-games

Standalone HTML5 games for [EldaTV](https://github.com/jcoe2412/EldaTV) — a
companion device that lets elderly users play simple games on their TV,
launched locally from EldaTV's own on-screen menu via a gamepad.

Each game is a single self-contained `index.html` (no build step, no
external dependencies) served over HTTPS via GitHub Pages, loaded into an
iframe by EldaTV's UI at `{portal_url}/{game}/index.html`.

See [PARAMS.md](PARAMS.md) for the URL query-parameter contract every game
follows (`lang`, `voice`, and game-specific options).

[`games.json`](games.json) lists every single-player game. EldaTV builds its **Games menu** from it — the
list, the thumbnail of the focused game and its description, in the TV's language — and the EldaRemote
companion app fetches it to let an admin pick which games are enabled on a given EldaTV device. Adding a
new game means adding its folder here (with a `thumbnail.svg`) *and* an entry in `games.json`, with no
change to EldaTV or EldaRemote:

```json
{
  "id": "simon",
  "label": "Simon",
  "labels":      { "en": "Simon", "fr": "Simon", "nl": "Simon" },
  "description": { "en": "…", "fr": "…", "nl": "…" },
  "thumbnail":   "simon/thumbnail.svg"
}
```

`label` is a plain string (the companion app reads it — keep it); `labels`, `description` and `thumbnail`
are what the TV shows. `games.json` must stay a JSON **array**.

### Thumbnail and description

Every game — single-player or online — comes with a **thumbnail** and a short **description in English, French and Dutch**.
EldaTV's Games menu shows the thumbnail of the focused game (right) and its description (below), in the TV's language;
the companion app can use the same data.

* **Thumbnail** — a picture of the game in action, **4:3** (400×300 is ideal), stored in the game's folder as
  `thumbnail.svg` (`.png`, `.jpg` and `.webp` are accepted too), **under 300 KB**. It is shown large on a TV, so
  use the game's own colours and shapes, no small print. SVG is recommended (sharp at any size, a few KB); draw
  with shapes rather than emoji or web fonts, which the TV may not have. No scripts.
  The manifest entry names it with a path relative to the repository root: `"thumbnail": "my-game/thumbnail.svg"`.
  A game that exists in both forms may share one thumbnail.
* **Description** — one or two plain sentences saying **what the game is and how it is won**, no jargon, at most
  ~140 characters per language (three lines on the TV).
* `node online/dev/validate.js` checks all of this (names and descriptions in every language, thumbnail present, a
  plain relative path, the right type and size) and the pull-request check runs it for you.

## Online (2-player) games

**Want to add one? See [`online/DEVELOPING.md`](online/DEVELOPING.md)** (specification, starter game, test bench) and
[`CONTRIBUTING.md`](CONTRIBUTING.md).

[`online/`](online/README.md) holds games played by two people on two devices —
one on the EldaRemote companion app, one on EldaTV. They are listed by
[`online-games.json`](online-games.json) (not `games.json`), can only be
started from the companion app, and need no code change in EldaTV or
EldaRemote to add: see [`online/README.md`](online/README.md).

## Games

- `tictactoe/`
- `simon/`
- `connect4/`
- `memory/`
- `breakout/`
- `tetris/`
- `online/connect4/` (2-player, see above)
