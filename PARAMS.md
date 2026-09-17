# Game URL Parameters

All four games (`simon/index.html`, `tictactoe/index.html`, `connect4/index.html`,
and `memory/index.html`) accept the following query-string parameters.
Parameters can be combined freely, e.g.:

    memory/index.html?lang=fr&voice=0&pairs=4

---

## `lang` — Interface language

| Value | Language |
|-------|----------|
| `en`  | English (default) |
| `fr`  | French |
| `nl`  | Dutch |

Affects all on-screen labels, status messages, and voice prompts.
The game title is also translated: Connect 4 → "Puissance 4" (fr) / "Vier op een rij" (nl).

---

## `voice` — Voice instructions (text-to-speech)

| Value | Behaviour |
|-------|-----------|
| *(absent)* or any value other than `0` | Voice **enabled** (default) |
| `0` | Voice **disabled** |

When enabled, the browser's built-in speech synthesis reads out key game
moments in the selected language.  A local (offline) voice is preferred
to avoid network requests; all phrases are pre-warmed on first interaction
so subsequent prompts play without delay.

Voice prompts are intentionally more verbose than the on-screen text, e.g.
"It's your turn! You play with X." rather than just "Your turn (X)".

Only messages directed at the player are spoken; AI-thinking and opponent-
turn messages are always silent.

### Memory-specific behaviour

The `pairs` parameter controls the grid size (Memory only):

| Value | Grid | Difficulty |
|-------|------|------------|
| `4`   | 4 × 2 (8 cards)  | Easy |
| `6`   | 4 × 3 (12 cards) | Medium **(default)** |
| `8`   | 4 × 4 (16 cards) | Hard |

Card size adjusts automatically — fewer pairs means larger cards.

---

### Simon-specific behaviour

When voice is **enabled**, the game pauses and waits for each prompt to
finish before continuing:

- "Watch carefully!" — spoken before the colour sequence begins; the
  sequence does not start until the phrase has finished.
- "Your turn!" — spoken after the sequence ends; player input is not
  accepted until the phrase has finished.
- "Wrong! Game over." — spoken immediately on a mistake.
- "Press any key to play again." — spoken ~2 s after a game over.

When voice is **disabled**, all voice-related pauses are removed and the
game transitions at full speed.
