# Online (2-player) games

Games in this folder are played by **two people on two devices**: one on the
EldaRemote companion app (the *guest*), one on EldaTV (the *host*). They are
listed by [`../online-games.json`](../online-games.json) — **not** by
`games.json`, so they never show up in EldaTV's local (single-player) grid or
in the admin's enable/disable list.

Adding a game is *data only*: a folder here + an entry in
`online-games.json`. Neither EldaTV nor EldaRemote needs a code change.

```
online/
  elda-online.js        the SDK every online game includes
  <id>/index.html       one self-contained game
../online-games.json    the manifest the companion app reads
```

## How it works

```
 game (iframe, https://…github.io)          parent page (EldaTV browser / EldaRemote PWA)          broker
 ─────────────────────────────────          ─────────────────────────────────────────────          ──────
 your game  ─ elda-online.js ─ postMessage ─► online-bridge.js ─ MQTT over ws://… ─► elda/game/<sid>/…
```

A game page is served over HTTPS, so the browser will not let it open the
broker's plain `ws://` socket (mixed content). The **parent** already owns an
MQTT connection and relays for the game; the game only ever uses
`postMessage`. The bridge ships with the apps and is *not* loaded from this
repo — the apps never execute remote code, only the sandboxed iframe does.

**Roles.** The TV is always the **host**: it applies the rules, it is the
source of truth, and it moves first. The phone is the **guest**. The
recommended pattern (not enforced): the guest sends *intents* (`send("move", …)`),
the host validates them and publishes an authoritative *snapshot* that both
sides render.

## URL parameters

The parent opens `<portal_url>/online/<id>/index.html?…` with:

| Param | Meaning |
|---|---|
| `role` | `host` or `guest` |
| `sid`  | session id (shared by both players) |
| `lang` | `en` / `fr` / `nl` — see [`../PARAMS.md`](../PARAMS.md) |
| `voice`| ignored — online games never use text-to-speech (see below) |

## The SDK

```html
<script src="../elda-online.js"></script>
<script>
const s = EldaOnline.connect({
  getSnapshot() { return state; },     // host: sent to the guest on every (re)join — recommended
  onSnapshot(state)        { },        // guest: the host's authoritative state
  onMessage(type, payload) { },        // either side: what the peer send()s
  onPeerJoined()           { },        // host: the guest (re)joined
  onPeerLeft(reason)       { },        // "peer_left" | "peer_timeout" — the session is over
  onLink(status)           { },        // "up" | "down": is the peer currently reachable?
});
s.role;                    // "host" | "guest"
s.sid;
s.send(type, payload);     // -> the peer's onMessage      (either role)
s.publishSnapshot(obj);    // -> the guest's onSnapshot    (host only)
s.leave();                 // ask the parent to end the session (Escape / quit)
</script>
```

* **Payloads must be JSON and ≤ 16 KB**; `type` is a string ≤ 32 chars.
* Whenever the link comes (back) up the guest automatically re-joins and the
  host answers with a fresh snapshot, and the host also pushes its snapshot on
  every link-up (it may have changed while its own connection was down), so a
  phone that was locked or lost its connection catches up without any game
  code. Keep the *entire* game state in the snapshot and this just works.
* **Make moves idempotent.** Messages can be delayed, retried or duplicated
  (double taps, retries after a timeout). Have each intent name the state it was
  based on — Connect 4 sends `ply` (the number of pieces on the board) and the
  host refuses a move whose `ply` no longer matches — and let the host bump a
  `rev` counter in every snapshot so the guest can tell a real update from a
  repeat.
* The parent ends the session on its own when the peer leaves, is silent for
  60 s, or the TV goes back to standby. What happens *next* (close the
  overlay, return to the video call, …) is decided by the parent, not by the
  game: a game is only a layer on top of whatever the device was doing. Games
  just show a "your opponent left" message.
* **Local development:** open the game outside any parent, in two tabs of one
  browser — `index.html?role=host&sid=x` and `index.html?role=guest&sid=x` —
  and the SDK relays between them with a `BroadcastChannel`.
* **No text-to-speech.** Online games are played during a video call, so they
  must not speak (sound effects are fine). Text-to-speech is for the local,
  single-player games only.
* **Show the opponent's choice live.** Send a lightweight `send("focus", …)`
  message whenever the player moves their cursor and draw the opponent's, so
  each side sees the other's selection *before* it is validated (Connect 4
  does this; throttle to ~15 messages/s). Games on touch screens should use a
  two-step *select, then confirm* interaction so there is something to show.
* Keep TV input working (keyboard arrows/Enter/Escape and the gamepad, as in
  the single-player games) and make the layout work on a phone in portrait
  too: the same page is used on both.

## Manifest — `online-games.json`

```json
{
  "sdk": 1,
  "games": [
    {
      "id": "connect4",
      "label":       { "en": "Connect 4", "fr": "Puissance 4", "nl": "Vier op een rij" },
      "description": { "en": "…", "fr": "…", "nl": "…" },
      "path": "online/connect4/index.html",
      "players": 2,
      "sdk": 1
    }
  ]
}
```

`id` must match `^[a-z0-9_-]+$` and the folder name. `path` is always
`online/<id>/index.html` — EldaTV builds the URL itself from that rule and
never opens anything it received over MQTT. `sdk` is the SDK/bridge protocol
version the game needs; an app that only understands an older one hides the
game instead of breaking. `players` is 2 for now.

## Protocol (what the bridges implement)

For bridge implementers — game authors can skip this.

MQTT, QoS 1, **not retained**, payload always the envelope
`{ "v": 1, "sid", "seq", "from": "host"|"guest", "type", "payload" }`:

| Topic | Direction | `type`s |
|---|---|---|
| `elda/game/<sid>/move`    | either → other | game-defined (`move`, `rematch`, …) |
| `elda/game/<sid>/state`   | host → guest   | `snapshot` |
| `elda/game/<sid>/control` | either → other | `join` (from the game), `hb`, `end` (bridge only) |

* `seq` is per sender, monotonic (starts at `Date.now()`, so a reloaded page
  never goes backwards). A receiver drops anything with `seq ≤` the last
  accepted one *per channel* (QoS 1 may duplicate), anything not `from` the
  peer role (own echoes), and anything for another `sid`.
* Heartbeat `hb` every 10 s; a received `hb` with `payload.ping` is answered
  immediately (used after a resync). Peer silent ≥ 30 s → link `down`;
  ≥ 60 s → the session ends with `peer_timeout` and the bridge publishes `end`.
* `end` (`{reason}`) ends the session for the peer (`peer_left`).
* After the page was hidden or MQTT reconnected the bridge drops the link and
  pings, so the guest's next `join` fetches a fresh snapshot.

`postMessage` contract, all messages `{ "elda": 1, "kind": … }`:

| Direction | `kind` | fields |
|---|---|---|
| game → parent | `hello` | `sdk`, `role`, `sid` |
| game → parent | `publish` | `channel` (`move`/`state`/`control`), `data: {type, payload}` — `state` only from the host, `control` only `join` |
| game → parent | `back` | the player wants out (legacy `{type:"elda_back"}` is also honoured) |
| parent → game | `recv` | `channel`, `data: {type, payload}` |
| parent → game | `link` | `status`: `up` / `down` |
| parent → game | `ended` | `reason`: `peer_left` / `peer_timeout` / `local_back` |

The parent only accepts messages with `event.source === iframe.contentWindow`
and `event.origin === <portal origin>`, and posts with an explicit
`targetOrigin`. The iframe is sandboxed with
`allow-scripts allow-same-origin`.

## Checklist: adding a game

1. Copy `connect4/` to `online/<id>/`, keep the SDK `<script>` line, replace the rules/UI.
2. Put **all** game state in what `getSnapshot()` returns.
3. Support `?lang=` (en/fr/nl); no speech; work on a 360 px-wide phone *and* a 1080p TV.
4. Add the entry to `online-games.json`.
5. Test locally in two tabs (see above), then push to `main` — GitHub Pages
   publishes it and the companion app lists it on its next visit to the Games tab.
