/* online-bridge.js — parent-side bridge for 2-player online games.
 *
 * Sits between a game iframe (elda-games/online/<id>/, using elda-online.js)
 * and the MQTT broker: the game only knows postMessage, this file owns the
 * MQTT topics, the heartbeat and the session lifecycle. The contract is
 * specified in elda-games/online/README.md.
 *
 * IDENTICAL COPY in EldaTV (tv/js/online-bridge.js) and EldaRemote
 * (js/online-bridge.js) — change both together. Deliberately shipped with the
 * apps and NOT loaded from GitHub: the parents never execute remote code,
 * only the sandboxed iframe does.
 *
 *   const b = EldaOnlineBridge.start({
 *     mqtt,          // { publish(topic, obj, qos), subscribe(pattern, fn(topic, obj)),
 *                    //   unsubscribe(pattern, fn), onConnect?(cb) }
 *     iframe,        // the game's <iframe>
 *     portalOrigin,  // e.g. "https://jcoe2412.github.io" — checked on every message
 *     sid, role,     // "host" | "guest"
 *     onLink(status),   // "up" | "down" — peer reachable?
 *     onEnded(reason, detail),  // reason: "peer_left" | "peer_timeout" | "local_back";
 *                               // detail (peer_left only): why the peer ended it —
 *                               // "local_back" (the player quit) or "local_stop"
 *                               // (their device ended the session, e.g. TV standby)
 *   });
 *   b.stop(notifyGame?); // parent-initiated end (publishes `end`, no onEnded)
 *
 * Wire envelope on elda/game/<sid>/{move|state|control}, QoS 1:
 *   { v:1, sid, seq, from:"host"|"guest", type, payload }
 */

const EldaOnlineBridge = (() => {
  "use strict";

  const HB_MS        = 10000;  // heartbeat period
  const CHECK_MS     = 2000;   // liveness check period
  const LINK_DOWN_MS = 30000;  // peer silent this long -> link "down"
  const END_MS       = 60000;  // peer silent this long -> session over
  const MAX_BYTES    = 16384;  // per published payload (sanity limit)
  const CHANNELS     = ["move", "state", "control"];

  function start(opts) {
    const { mqtt, iframe, portalOrigin, sid, role } = opts;
    const onLink  = opts.onLink  || (() => {});
    const onEnded = opts.onEnded || (() => {});
    const peer = role === "host" ? "guest" : "host";
    const base = `elda/game/${sid}`;
    const pattern = `${base}/#`;

    let seq = Date.now();          // monotonic across reloads of the same side
    const lastSeq = {};            // channel -> last accepted seq from the peer
    let link = "down";
    let ended = false;
    let lastPeerSeen = Date.now();
    let lastHb = 0;

    // ── MQTT side ───────────────────────────────────────────────────────
    function publish(channel, type, payload) {
      seq = Math.max(seq + 1, Date.now());
      mqtt.publish(`${base}/${channel}`,
        { v: 1, sid, seq, from: role, type, payload: payload === undefined ? null : payload }, 1);
    }

    function onMqtt(topic, env) {
      if (ended || !env || typeof env !== "object") return;
      const channel = String(topic).split("/").pop();
      if (!CHANNELS.includes(channel)) return;
      if (env.v !== 1 || env.sid !== sid || env.from !== peer) return;   // also drops our own echoes
      if (typeof env.type !== "string" || typeof env.seq !== "number") return;
      if (env.seq <= (lastSeq[channel] === undefined ? -Infinity : lastSeq[channel])) return; // dup / stale
      lastSeq[channel] = env.seq;

      lastPeerSeen = Date.now();
      if (channel === "control" && env.type === "end") {
        finish("peer_left", false, env.payload && typeof env.payload.reason === "string" ? env.payload.reason : "");
        return;
      }
      setLink("up");
      if (channel === "control" && env.type === "hb") {
        if (env.payload && env.payload.ping) heartbeat();   // peer just resynced: answer right away
        return;
      }
      toFrame({ elda: 1, kind: "recv", channel, data: { type: env.type, payload: env.payload } });
    }

    function heartbeat(ping) {
      lastHb = Date.now();
      publish("control", "hb", ping ? { ping: true } : null);
    }

    // ── iframe side ─────────────────────────────────────────────────────
    function toFrame(msg) {
      try { iframe.contentWindow.postMessage(msg, portalOrigin); } catch (_) { /* frame gone */ }
    }

    function onWindowMessage(evt) {
      if (ended || evt.source !== iframe.contentWindow || evt.origin !== portalOrigin) return;
      let d = evt.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "elda_back") d = { elda: 1, kind: "back" };      // legacy single-player message
      if (d.elda !== 1) return;

      if (d.kind === "hello") {
        toFrame({ elda: 1, kind: "link", status: link });
      } else if (d.kind === "back") {
        finish("local_back", true);
      } else if (d.kind === "publish") {
        const data = d.data;
        if (!data || typeof data.type !== "string" || data.type.length > 32) return;
        if (!CHANNELS.includes(d.channel)) return;
        if (d.channel === "state" && role !== "host") return;         // only the host is authoritative
        if (d.channel === "control" && data.type !== "join") return;  // hb/end belong to the bridge
        let size = 0;
        try { size = JSON.stringify(data.payload === undefined ? null : data.payload).length; } catch (_) { return; }
        if (size > MAX_BYTES) return;
        publish(d.channel, data.type, data.payload);
      }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────
    function setLink(status) {
      if (status === link) return;
      link = status;
      if (status === "up") heartbeat();     // let the peer learn about us without waiting for its next tick
      toFrame({ elda: 1, kind: "link", status });
      try { onLink(status); } catch (e) { console.error("[OnlineBridge] onLink:", e); }
    }

    function tick() {
      if (ended) return;
      const now = Date.now();
      if (now - lastHb >= HB_MS) heartbeat();
      const silence = now - lastPeerSeen;
      if (silence >= END_MS) finish("peer_timeout", true);
      else if (silence >= LINK_DOWN_MS) setLink("down");
    }

    // After the page was in the background or MQTT reconnected we may have
    // missed messages: drop the link so the next peer message re-triggers the
    // guest's join -> the host answers with a fresh snapshot.
    function resync() {
      if (ended) return;
      lastPeerSeen = Date.now();
      setLink("down");
      heartbeat(true);
    }
    function onVisibility() { if (!document.hidden) resync(); }

    function finish(reason, publishEnd, detail) {
      if (ended) return;
      if (publishEnd) publish("control", "end", { reason });
      teardown();
      toFrame({ elda: 1, kind: "ended", reason });
      try { onEnded(reason, detail); } catch (e) { console.error("[OnlineBridge] onEnded:", e); }
    }

    function teardown() {
      ended = true;
      clearInterval(timer);
      window.removeEventListener("message", onWindowMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      mqtt.unsubscribe(pattern, onMqtt);
    }

    window.addEventListener("message", onWindowMessage);
    document.addEventListener("visibilitychange", onVisibility);
    // (the MQTT clients re-subscribe on their own after a reconnect)
    if (mqtt.onConnect) mqtt.onConnect(resync);
    mqtt.subscribe(pattern, onMqtt);
    const timer = setInterval(tick, CHECK_MS);
    heartbeat(true);

    return {
      // notifyGame: optional reason ("peer_left"...) to tell the game the
      // session is over, for when the parent ends it because the *peer's*
      // device already did (e.g. the TV left GAME) and the game is still
      // on screen showing the final board.
      stop(notifyGame) {
        if (ended) return;
        publish("control", "end", { reason: "local_stop" });
        teardown();
        if (notifyGame) toFrame({ elda: 1, kind: "ended", reason: notifyGame });
      },
      get link() { return link; },
    };
  }

  return { start };
})();
