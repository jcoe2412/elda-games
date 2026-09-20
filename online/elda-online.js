/* elda-online.js — game-side SDK for 2-player online games (SDK version 1).
 *
 * A game never talks to MQTT, EldaTV or the companion app. It talks to its
 * *parent page* (the "bridge") through window.postMessage, and this file
 * wraps that contract in a small API. See README.md in this folder.
 *
 *   const s = EldaOnline.connect({
 *     getSnapshot() { return state; },      // host: sent to the guest on every (re)join
 *     onSnapshot(state)          {},        // guest: authoritative state from the host
 *     onMessage(type, payload)   {},        // either side: whatever the peer send()s
 *     onPeerJoined()             {},        // host: the guest (re)joined
 *     onPeerLeft(reason)         {},        // "peer_left" | "peer_timeout"
 *     onLink(status)             {},        // "up" | "down" — is the peer reachable?
 *   });
 *   s.role                    // "host" | "guest"  (from ?role=)
 *   s.sid                     // session id        (from ?sid=)
 *   s.send(type, payload)     // -> the peer's onMessage
 *   s.publishSnapshot(obj)    // host only -> the guest's onSnapshot
 *   s.leave()                 // ask the parent to end the session (Escape / quit)
 *
 * Opened outside any parent (no iframe) the SDK falls back to a
 * BroadcastChannel loopback, so a game can be developed by opening
 *   index.html?role=host&sid=x    and    index.html?role=guest&sid=x
 * in two tabs of the same browser.
 */
(function (root) {
  "use strict";

  const JOIN_RETRY_MS = 3000;

  function connect(handlers) {
    const h = handlers || {};
    const params = new URLSearchParams(root.location.search);
    const role = params.get("role") === "guest" ? "guest" : "host";
    const sid = params.get("sid") || "dev";

    let link = "down";
    let haveSnapshot = false;
    let closed = false;
    let post;

    // ── Transport: the real bridge, or a same-browser loopback for dev ──
    const standalone = !root.parent || root.parent === root;
    if (!standalone) {
      post = (msg) => root.parent.postMessage(Object.assign({ elda: 1 }, msg), "*");
      root.addEventListener("message", (e) => {
        if (e.source === root.parent) onParent(e.data);
      });
    } else {
      const bc = new BroadcastChannel("elda-online-" + sid);
      post = (msg) => {
        if (msg.kind === "publish") {
          bc.postMessage({ from: role, channel: msg.channel, data: msg.data });
        } else if (msg.kind === "back") {
          bc.postMessage({ from: role, kind: "ended" });
        }
      };
      bc.onmessage = (e) => {
        const m = e.data;
        if (!m || m.from === role) return;
        if (m.kind === "ended") return onParent({ elda: 1, kind: "ended", reason: "peer_left" });
        if (link !== "up") {
          onParent({ elda: 1, kind: "link", status: "up" });
          bc.postMessage({ from: role, channel: "control", data: { type: "hb" } });
        }
        if (m.channel !== "control" || m.data.type !== "hb") {
          onParent({ elda: 1, kind: "recv", channel: m.channel, data: m.data });
        }
      };
      bc.postMessage({ from: role, channel: "control", data: { type: "hb" } });
    }

    // ── Parent -> game ──────────────────────────────────────────────────
    function onParent(d) {
      if (closed || !d || d.elda !== 1) return;
      if (d.kind === "recv") {
        const data = d.data || {};
        if (d.channel === "state") {
          haveSnapshot = true;
          if (h.onSnapshot) h.onSnapshot(data.payload);
        } else if (d.channel === "move") {
          if (h.onMessage) h.onMessage(data.type, data.payload);
        } else if (d.channel === "control" && data.type === "join" && role === "host") {
          if (h.getSnapshot) publishSnapshot(h.getSnapshot());
          if (h.onPeerJoined) h.onPeerJoined();
        }
      } else if (d.kind === "link") {
        setLink(d.status === "up" ? "up" : "down");
      } else if (d.kind === "ended") {
        if (h.onPeerLeft) h.onPeerLeft(d.reason);
      }
    }

    function setLink(status) {
      if (status === link) return;
      link = status;
      if (status === "down") haveSnapshot = false;
      else if (role === "guest") sendJoin();     // (re)joined -> ask for a fresh snapshot
      if (h.onLink) h.onLink(status);
    }

    // ── Game -> parent ──────────────────────────────────────────────────
    function sendJoin() {
      post({ kind: "publish", channel: "control", data: { type: "join" } });
    }

    function send(type, payload) {
      post({ kind: "publish", channel: "move", data: { type: String(type), payload } });
    }

    function publishSnapshot(obj) {
      if (role !== "host") return;
      post({ kind: "publish", channel: "state", data: { type: "snapshot", payload: obj } });
    }

    function leave() {
      post({ kind: "back" });
    }

    post({ kind: "hello", sdk: 1, role, sid });

    // The guest keeps asking until it holds a snapshot: the host may not have
    // started listening yet when the very first join goes out.
    let joinTimer = null;
    if (role === "guest") {
      sendJoin();
      joinTimer = setInterval(() => { if (!haveSnapshot) sendJoin(); }, JOIN_RETRY_MS);
    }

    return {
      role, sid, send, publishSnapshot, leave,
      isLinked: () => link === "up",
      close() { closed = true; if (joinTimer) clearInterval(joinTimer); },
    };
  }

  root.EldaOnline = { connect, sdk: 1 };
})(typeof window !== "undefined" ? window : globalThis);
