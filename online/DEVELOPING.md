# Developing online games for Elda

This guide is for **anyone who wants to add a two-player online game** to this repository. You do not need an
EldaTV, the companion app, or any knowledge of how they work: everything you need to build *and test* a game is in
this repo.

Contents: [1. What you are building](#1-what-you-are-building) · [2. Quick start](#2-quick-start) ·
[3. The specification](#3-the-specification) · [4. Testing](#4-testing) · [5. Contributing](#5-contributing-your-game) ·
[6. Troubleshooting](#6-troubleshooting)

---

## 1. What you are building

**Elda** is a small home system for older people: **EldaTV** (a Raspberry Pi driving the living-room TV) and
**EldaRemote** (the phone app family members use). An *online game* lets **one person on the phone and one person at
the TV play together**, typically **while they are in a video call**.

* A game is **one self-contained HTML page** in `online/<your-id>/index.html`. GitHub Pages publishes this repository,
  and both devices load your page inside a sandboxed `<iframe>`.
* You write the game (rules + drawing). **You write no networking code.** Your page talks only to the small SDK
  ([`elda-online.js`](elda-online.js)); the app around it relays messages over the home network.
* The two devices have fixed roles:

  | | Device | Role | Notes |
  |---|---|---|---|
  | **host** | TV | applies the rules, owns the game state, moves first | keyboard / gamepad, viewed from the sofa |
  | **guest** | phone | sends its moves to the host, draws what the host says | touch, portrait |

* Adding a game is **data only**: a folder plus a line in [`../online-games.json`](../online-games.json). No change to
  the TV software or the phone app is ever needed — that is a design goal, and the reason the rules below are strict.
* A game is a **layer on top of whatever the device is doing**. When it ends (someone quits, or the connection is
  lost) the app simply removes it — a video call underneath just continues. Your game must never assume it is the
  only thing happening, and must never try to leave the page itself.

```
 your game (iframe, https://…github.io)          the app around it                      home network
 ──────────────────────────────────────          ────────────────────────────           ────────────
 your code ─ elda-online.js ─ postMessage ─►  bridge (heartbeat, ordering, link) ─►  MQTT broker
```

## 2. Quick start

You need a browser and **either** Node.js **or** Python (only to serve files over `http://`).

```bash
git clone https://github.com/<you>/elda-games.git && cd elda-games      # your fork, see §5
node online/dev/serve.js               # or:  python -m http.server 8080
#  -> open  http://localhost:8080/online/dev/      (the test bench)

cp -r online/_template online/my-game  # start from a small working game
```

1. Open the bench, choose **`_template (starter)`** and play it: the TV screen is on the left, the phone on the right,
   both running the real bridge over a *simulated* network. Then run **Run all checks**.
2. Edit `online/my-game/index.html` (rules and drawing; keep everything marked `◆ KEEP`). Reload the bench, type
   `my-game` into **or id**, press **New session**.
3. **Run all checks** until everything is green. Run `node online/dev/validate.js my-game` for the static checks.
4. Add your game to [`../online-games.json`](../online-games.json) (§3.12) and open a pull request (§5).

## 3. The specification

Words in capitals are meant literally: **MUST** (the app or the checks break without it), **SHOULD** (strongly
recommended; reviewers will ask why you did not). Requirements are numbered so a reviewer can point at them.

### 3.1 Files and location

* **R1** — The game MUST be the single file `online/<id>/index.html`, where `<id>` matches `^[a-z0-9_-]{1,40}$` and is
  unique. Styles, script and small assets live inline (SVG, data URIs). The file MUST NOT exceed 500 KB (aim for
  under 100 KB: it is downloaded over the internet on every launch).
* **R2** — It MUST load the SDK with `<script src="../elda-online.js"></script>` and MUST NOT copy or modify it.
* **R3** — It MUST be self-contained: no external scripts, styles, fonts or images, and no `fetch` / `XMLHttpRequest` /
  `WebSocket`. **All** traffic goes through the SDK.
* **R4** — It MUST NOT use `eval` / `new Function`, open windows, or navigate the page or its parents. The iframe is
  sandboxed (`allow-scripts allow-same-origin`). It SHOULD NOT use `localStorage` & co.: there is nothing to persist,
  and it is not shared between the two devices anyway.
* **R5** — Do not name a folder starting with `_` for a real game: those are reserved for templates and are never listed.

### 3.2 What your page receives

The app opens `online/<id>/index.html?role=host|guest&sid=<session>&lang=en|fr|nl`. The SDK reads `role` and `sid`
for you (`s.role`, `s.sid`); you read `lang` (§3.9). Other parameters (for example an old `voice=`) MUST be ignored.

### 3.3 Roles and authority

* **R6** — Only the **host** applies the rules. The guest sends *intents* ("I want to play square 5") and draws what the
  host publishes. Never let the guest decide anything that matters.
* **R7** — The host is player 1 and moves first in the first round. On a rematch the starter SHOULD alternate.
* **R8** — Colours are a convention that players learn: host = blue `#4488ff`, guest = orange `#ff6633`. Say clearly
  who you are ("You play X").

### 3.4 State and ordering — read this one carefully

Messages over a home network arrive **late (seconds), twice, or not at all** (a phone that locks its screen, a TV that
reboots its browser). The SDK repairs a lot, but only a game written like this stays correct:

* **R9** — The host's **snapshot is the whole truth**. Everything needed to draw the game (board, turn, scores,
  rematch flags, …) MUST be in it, because a phone that joins late or reconnects receives *only* that.
* **R10** — Every snapshot MUST carry `epoch` (a random id created once when the host page loads) and `rev` (an integer
  the host increases by one on every publish). Together they distinguish a *new* state from a *repeat*.
* **R11** — The host MUST hand the snapshot to the SDK **first**, and only then redraw, play sounds, animate:
  `publishSnapshot(next); adopt(next);` (never the other way round). Nothing local may delay the other player.
* **R12** — The guest MUST ignore a snapshot it already has (same `epoch` and `rev`) — the SDK re-sends periodically
  and answers every join — and MUST validate the shape of every snapshot it adopts.
* **R13** — An intent MUST name the state it was based on (Connect 4 sends `ply` = number of pieces on the board). The host
  MUST refuse an intent whose `ply` no longer matches. This makes double taps, retries and late messages harmless.
* **R14** — After sending an intent the guest keeps it *pending* (blocks further input) until the host has really moved
  on (`rev` advanced). If nothing arrives within ~4 s it MUST release input and send `sync`.
* **R15** — The host MUST answer a refused intent and a `sync` with the *same* state under a **new `rev`** (this releases
  the guest's pending move).
* **R16** — Treat everything from the wire as untrusted: check types and ranges (the host validates guest intents, the
  guest validates snapshots). A malformed message MUST be ignored, never crash the page.
* **R17** — Do not rely on ordering *between* message types or on delivery.

What the SDK already does for you: the guest asks for a snapshot every second at first (then every 3 s) until it has
one; the host re-publishes its snapshot every 5 s, on every join and whenever its link comes back up; both sides are
told when the link goes down or comes up (`onLink`) and when the other side leaves (`onPeerLeft`).

*Why these rules exist:* each was a real bug found while building Connect 4. A guest that sent a second move while the
first was in flight got it applied as an extra move (→ R13/R14); a host that moved while its own connection was down
left the phone one move behind until someone happened to move (→ R9/R15 and the periodic re-send).

### 3.5 Messages

* **R18** — Use these names, so every game behaves the same way: `move` (an intent, guest → host), `focus` (a live
  selection, either way), `rematch`, `sync`. Other game-specific types are fine. The bench checks the intents you send with the type **`move`** (see the *stale or duplicate* check in §4.2), so use that name for the message that carries a player's choice.
* **R19** — Payloads MUST be JSON of at most **16 KB**; the `type` is a string of at most **32 characters**. Send at most
  ~15 `focus` messages per second (throttle to ≥ 60 ms).

```js
sess.send("move", { cell: 5, ply: 3 });        // either side -> the other side's onMessage(type, payload)
sess.publishSnapshot(state);                    // host only  -> the guest's onSnapshot(state)
sess.leave();                                   // ask the app to end the session
```

### 3.6 Lifecycle and screens

* **R20** — The game MUST show clearly when it is waiting (`onLink("down")` before it ever linked: *waiting / connecting*;
  after it had linked: *connection lost — waiting*) and MUST NOT accept input while unlinked.
* **R21** — On `onPeerLeft` it MUST show that the other player left and stop accepting moves. It MUST NOT try to close or
  reload itself: the app removes the layer.
* **R22** — **Escape** (keyboard), **B** or **Start** (gamepad) MUST call `sess.leave()` at any time.
* **R23** — When a round ends, show the result and a *Play again* action; a rematch starts only when **both** agreed.

### 3.7 Input

The TV player uses a keyboard or gamepad, the phone player a finger.

* **R24 Keyboard** — arrows to move, **Enter** or **Space** to confirm, **Escape** to quit. Attach handlers to `document`.
* **R25 Gamepad** (standard mapping, `navigator.getGamepads()`) — d-pad `14`/`15`/`12`/`13` (left/right/up/down) and/or
  stick axes `0`/`1`, **A** (`0`) confirms, **B** (`1`) or **Start** (`9`) quits.
* **R26 Touch** — a **first tap selects, a second tap on the same target confirms** (detect touch with
  `matchMedia("(pointer: coarse)")`). The selection is sent as `focus` so the other player *sees your choice before you
  validate it*, and it prevents accidental moves. **Exception:** when the input is a rapid sequence of presses that are each
  harmless and give instant feedback (a Simon-style game: [`simon-duel/`](simon-duel/index.html)), one tap acts, and the whole
  turn is sent as **one** intent when it is complete so a slow network cannot lag the pressing.
* **R27** — The opponent's live selection SHOULD be drawn (e.g. a dashed outline in their colour) while it is their turn.
* **R28** — Interactive elements need `cursor: pointer` and a phone target of at least ~44 px. (The test bench finds what
  to tap by looking for `cursor: pointer`.)

### 3.8 Display

Two very different screens must work from the same file:

| | Size (landscape/portrait) | Viewed | So |
|---|---|---|---|
| **TV** | 1920×1080, also 1280×720 | from the sofa, by people with poor eyesight | big text (status ≥ 2rem), strong contrast, thick borders (≥ 5 px) |
| **Phone** | 390×844, also 360×640 portrait | in the hand | fits the width, big touch targets |

* **R29** — The page MUST NOT scroll or overflow at any of those four sizes. Size things with `vh` / `vw` / `min()` and
  switch layouts with `@media (max-aspect-ratio: 1/1)` for portrait.
* **R30** — Dark background (`#0e0e1c`), light text. Keep board lines and cell borders clearly visible (a border that
  looks fine on a monitor can be invisible on a TV).

**A game that exists in both a single-player and a two-player form must look and feel the same in both.** The
single-player game (`<id>/index.html` at the repository root) is the reference: reuse its layout, cards/pieces, colours,
typography, sounds, status wording and colours, and translations, and add only what two players need — whose turn it is,
the opponent's live cursor, both scores, a phone layout. Look at what the existing pairs do
([`memory/`](../memory/index.html) ↔ [`online/memory/`](memory/index.html), [`simon/`](../simon/index.html) ↔
[`online/simon-duel/`](simon-duel/index.html)). Do not change the single-player game to suit the online one.

### 3.9 Languages

* **R31** — English, French and Dutch are required. Read `?lang=` (`en` default; accept `fr-BE`-style values by taking the
  part before `-`/`_`). Every visible string is translated, including status messages and hints.

### 3.10 Sound

* **R32** — **No text-to-speech.** Online games are played during a video call, where a talking page would talk over the
  call. Short sound effects are allowed: create the `AudioContext` lazily, resume it on the first key press / tap, and
  play sounds **after** drawing and publishing (`setTimeout(…, 0)`, see R11).

### 3.11 The debug hook

* **R33** — Define `window.eldaDebugState = () => state;` returning the **shared** (host-published) state, JSON-serialisable.
  The bench uses it to check that host and guest agree and to tell whether input changed anything. Without it the
  convergence checks are skipped and reviewers cannot verify your game. Compare states *without* `rev` and `epoch`
  in mind: keep the state deterministic (no timestamps or random values inside it), or the comparison reports
  differences that are not bugs.
* **R34** — You SHOULD also define `window.eldaDebugInvariant = (state) => null | "message"`, returning a short message when
  a state is **impossible** (a floating piece in Connect 4, a total above the target, …). The bench calls it on every state
  either side shows during every play-based check, so a rules bug is reported the moment the impossible state appears —
  with the state's message — instead of as a vague "states differ" later.

* **R35** — If random keys and taps rarely produce a *valid* move in your game (draughts, chess, anything where a move needs a
  specific sequence of inputs), define `window.eldaDebugRandomInput = () => void`: perform **one random meaningful input for the
  local player** — through the *same* handlers real input uses (select a piece, confirm a move, ask for a rematch), doing nothing
  when it is not this player's turn. The bench then mixes it into the auto-play (about 70 % of the inputs); without it the
  *Keyboard / taps change the game* and *stale move* checks may fail for lack of activity.

### 3.12 The manifest entry

Add one object to [`../online-games.json`](../online-games.json):

```json
{
  "id": "my-game",
  "label":       { "en": "My Game",         "fr": "Mon jeu",            "nl": "Mijn spel" },
  "description": { "en": "Play … against the person at the TV",  "fr": "…", "nl": "…" },
  "path": "online/my-game/index.html",
  "players": 2,
  "sdk": 1
}
```

`path` is always `online/<id>/index.html` (the apps build the URL themselves from the id and never open anything else);
`players` is `2`; `sdk` is the SDK version your game needs (`1` today — an app that only knows an older SDK hides the
game instead of breaking).

## 4. Testing

There are four levels; you can do the first three with nothing but this repository.

### 4.1 The test bench — `online/dev/index.html`

Serve the repo (`node online/dev/serve.js`, or `python -m http.server 8080`) and open
`http://localhost:8080/online/dev/`. Pick a game (or type an id) and press **New session**:

* **Left, the TV** (host, 1920×1080, scaled down) and **right, the phone** (guest, 390×844) each run your page in a
  sandboxed iframe, exactly like the apps, connected by the **real bridge code** the apps ship
  ([`dev/online-bridge.js`](dev/online-bridge.js)) over a **simulated MQTT network**.
* Click a screen and use the keyboard, or tap its buttons with the mouse.
* **Simulated network** — latency, message loss, duplicated messages (delivered *late*, like an MQTT retransmit), "TV/phone offline", "lose the TV's state messages
  for 8 s", restart either page, make either side press Esc, and **Auto-play** (random keys and taps from both players).
  Also set how long each page takes to load, to reproduce a slow start.
* **State** — shows whether host and guest hold the same state (needs `eldaDebugState`, R33).
* **Wire log** — every message with its delay, loss or duplication. Turn on the network faults, play, and watch what
  your game receives.

### 4.2 The automatic checks

**Run all checks** (about three minutes; **Quick run** about one) plays your game through the situations that broke real
games. Every check must pass before you open a pull request.

| Check | What it does | If it fails |
|---|---|---|
| Both pages load, run without errors and link up | starts a session, watches for script errors | fix the error shown; make sure the page calls `EldaOnline.connect` |
| The guest receives the host's state | waits for the guest to hold a state | implement `getSnapshot` and R9; the guest must adopt valid snapshots |
| Keyboard / taps change the game | random keys and taps for 8 s, expects the state to change | handlers on `document`; real `<button>`/`cursor:pointer` elements (R24, R28) |
| TV page loads 8 s after the phone | slow TV start | joins may arrive before the host page is ready — rely on the SDK re-sending; do not require a first move |
| Phone page loads 8 s after the TV | slow phone start | the guest must draw *something* before it has a state (R20) and adopt the first snapshot it gets |
| The host's first states are lost for 8 s | drops the host's state messages | do not depend on one initial snapshot; keep `getSnapshot` correct at all times |
| Fast random play, 0–800 ms latency | random input on both sides, then compares states | R10–R15: publish first, `rev`, `ply` guard, pending handling |
| Bad network: 3 s latency, 20 % late duplicates, 5 % lost | same, hostile | same; also R12 (ignore repeats) |
| A stale or duplicate `move` from the phone is never applied | mostly phone input on a network that delivers late duplicates; records every `move` the phone sends together with the state it was based on, and every `move` the host *applies* | the host applied a move the phone did not send from that state: add the `ply` guard (R13) and the pending handling (R14) |
| Phone / TV goes offline for 8 s during play | offline in the middle of a game | the returning side must catch up: `getSnapshot` complete (R9), no state kept outside the snapshot |
| TV page restarts mid-game | the host page is killed and reloaded | a new `epoch` must be accepted by the guest (R10/R12) |
| Esc on one side ends the session on the other | presses Escape on each side | call `sess.leave()` on Escape (R22) |
| No scrolling / overflow at 4 sizes | 1920×1080, 1280×720, 390×844, 360×640 | R29/R30 |
| No text-to-speech | scans the source | remove `speechSynthesis` (R32) |

A check that says **skipped** (yellow) means the game has no `eldaDebugState` (R33), or — for the *stale or duplicate* check —
that the phone never sent a `move` (R18).

Three **observers** also watch *every* play-based check, whichever check is running, and fail it with their own message:

* **stale / duplicate moves** — as described above (needs `eldaDebugState`, and the `move` type);
* **impossible states** — whatever your `eldaDebugInvariant` (R34) reports;
* **going back in time** — the state's `rev` must never decrease within one `epoch` on either side (a stale snapshot was adopted, R12).

The bridge already drops network-level duplicates, so a duplicate `move` can only come from **the game itself** sending twice
(a double tap, a retry timer, a stale snapshot releasing input too early) and a host that applies it. That is what the check catches.

### 4.3 The static validator

```bash
node online/dev/validate.js            # every listed game and the starter template
node online/dev/validate.js my-game    # just yours (works before it is listed in the manifest)
```

Errors fail the run; warnings are advice. It checks the manifest (ids, paths, en/fr/nl texts), that the SDK is loaded,
that the required handlers exist, and that the game does not break R3/R4/R32. It is fast and static — it complements
the bench, it does not replace it. The same validator runs automatically on every pull request.

### 4.4 Quick two-tab loopback (no bench)

Open the game outside any app, in **two tabs of the same browser**:

```
http://localhost:8080/online/my-game/index.html?role=host&sid=x
http://localhost:8080/online/my-game/index.html?role=guest&sid=x
```

The SDK notices there is no parent page and relays between the two tabs itself (`BroadcastChannel`). Handy for the first
minutes of development; use the bench for anything about timing or failures.

### 4.5 What only real devices can show

The bench cannot reproduce the phone's actual touch behaviour, a real gamepad, real audio, or how the page looks from
three metres. Maintainers play every new game once on a real TV and phone before it is announced. If you have an
EldaTV, the game appears in the app's *Games* tab as soon as the pull request is merged.

## 5. Contributing your game

The site is published from the `main` branch of this repository, so **a game goes live the moment its pull request is
merged**. Please work on a fork:

1. **Fork** the repository and create a branch (`git checkout -b add-my-game`).
2. Add `online/<id>/index.html` and the entry in [`../online-games.json`](../online-games.json). Change nothing else
   (a game must never need changes elsewhere; if you think it does, open an issue first).
3. Run **all checks** in the bench and `node online/dev/validate.js <id>`; both must be clean.
4. Open a **pull request**. Say what the game is, how it is played, and paste the bench's check results. The
   validator runs automatically; a maintainer reviews the game against §3 and tries it on a real TV.

Pull-request checklist:

- [ ] one folder `online/<id>/index.html` + one manifest entry, nothing else
- [ ] all bench checks pass; `node online/dev/validate.js <id>` passes
- [ ] en / fr / nl texts (page **and** manifest)
- [ ] readable on a TV from the sofa and usable on a 360 px-wide phone
- [ ] keyboard, gamepad and touch (select, then confirm) all work; Esc quits
- [ ] no speech, no network requests, no external files

## 6. Troubleshooting

| Symptom | Likely cause |
|---|---|
| The bench shows *page loading…* forever | wrong id, or you opened the bench with `file://` — serve over `http://` (the bridge checks the origin of every message) |
| Both pages show *Connecting…* | the game never calls `EldaOnline.connect`, or throws while loading (see the browser console) |
| The guest stays on *Connecting…* until the TV moves | the host has no `getSnapshot` handler, or its state is `null` when asked |
| Marks / pieces missing although the state is right | rendering bug — check that you write visible content, not only classes/data attributes |
| Moves get applied twice or a piece appears that nobody chose | intents do not carry `ply` (R13), or the guest sends again while pending (R14) |
| Host and guest differ *forever* after a network fault | state kept outside the snapshot (R9), or a guest ignoring a snapshot with a **new** `epoch` (R12) |
| A repeat snapshot resets the opponent's cursor / selection | you adopt snapshots you already have — compare `epoch` + `rev` first (R12) |
| The layout check fails on the phone only | fixed pixel sizes; use `vw` / `min()` and the portrait media query (R29) |

## Reference

* The SDK API, the wire protocol and the `postMessage` contract: [`README.md`](README.md).
* A complete small game to copy: [`_template/index.html`](_template/index.html). Full games: [`connect4/`](connect4/index.html),
  [`tictactoe/`](tictactoe/index.html).
* For maintainers: `online/dev/online-bridge.js` is a **vendored, byte-identical copy** of the bridge shipped in EldaTV
  (`tv/js/online-bridge.js`) and EldaRemote (`js/online-bridge.js`). After changing the bridge there, refresh this copy and run
  `node online/dev/validate.js --bridge=<path-to-EldaRemote>/js/online-bridge.js --bridge=<path-to-EldaTV>/tv/js/online-bridge.js`.
