# Contributing

## Adding an online (2-player) game

Everything is in **[online/DEVELOPING.md](online/DEVELOPING.md)**: what an online game is, the specification your game
must follow, a starter game to copy (`online/_template/`), a browser **test bench** that simulates a TV and a phone
with a faulty network (`online/dev/`), and a static validator. You do **not** need an EldaTV to develop and test a game.

The short version:

1. Fork this repository and create a branch.
2. `cp -r online/_template online/<your-id>`, build your game, add an entry to `online-games.json`.
3. `node online/dev/serve.js`, open `http://localhost:8080/online/dev/` and make **Run all checks** pass;
   run `node online/dev/validate.js <your-id>`.
4. Open a pull request (the validator runs automatically). A maintainer reviews it against the specification and tries it on a real TV.

The site is published from `main`, so a game goes live as soon as its pull request is merged. Please change nothing
except your game's folder and its manifest entry.

## Single-player games

Single-player games (`tictactoe/`, `simon/`, `connect4/`, `memory/`) follow [PARAMS.md](PARAMS.md); add the folder and an entry in `games.json`.
