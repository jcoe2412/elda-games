# elda-games

Standalone HTML5 games for [EldaTV](https://github.com/jcoe2412/EldaTV) — a
companion device that lets elderly users play simple games on their TV,
launched locally from EldaTV's own on-screen menu via a gamepad.

Each game is a single self-contained `index.html` (no build step, no
external dependencies) served over HTTPS via GitHub Pages, loaded into an
iframe by EldaTV's UI at `{portal_url}/{game}/index.html`.

See [PARAMS.md](PARAMS.md) for the URL query-parameter contract every game
follows (`lang`, `voice`, and game-specific options).

[`games.json`](games.json) lists every game with an id + display label — the
EldaRemote companion app fetches it to let an admin pick which games are
enabled on a given EldaTV device. Adding a new game means adding its folder
here *and* an entry in `games.json`.

## Games

- `tictactoe/`
- `simon/`
- `connect4/`
- `memory/`
