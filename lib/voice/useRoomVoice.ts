"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type VoiceStatus = "idle" | "connecting" | "waiting" | "connected" | "error";
/** Error codes surfaced by the hook; the UI maps them to i18n strings. */
export type VoiceError = "mic" | "conn" | null;

export type VoiceMode = "player" | "listener";

interface UseRoomVoiceArgs {
  roomId: string;
  myUserId: string;
  /**
   * Player mode only: EVERY other seated player in the match (Ô Ăn
   * Quan seats 2–4, so 1–3 peers). One mesh link is built per pair —
   * never a single "opponent" as in the 2-player games.
   */
  peerUserIds: string[];
  mode?: VoiceMode;
}

interface VoiceState {
  status: VoiceStatus;
  joined: boolean;
  muted: boolean;
  error: VoiceError;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  /** Player mode: whether spectators may listen to MY audio. */
  listenersAllowed: boolean;
  setListenersAllowed: (v: boolean) => void;
  /** Player mode: how many listeners are currently in the voice channel. */
  listenerCount: number;
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const CHANNEL_PREFIX = "room-voice:";
/** Cap automatic re-offers so a pathological network can't loop forever. */
const MAX_RESTARTS = 3;

interface SignalPayload {
  from: string;
  to: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface PresenceMeta {
  role?: "player" | "listener";
  listenAllowed?: boolean;
}

function isInitiator(myId: string, peerId: string): boolean {
  return myId < peerId;
}

/** Nonogram's createClient() throws when the Supabase env vars are
 *  missing (solo play must keep working) — voice simply stays offline
 *  in that case instead of crashing the match view. */
function sbClient(): ReturnType<typeof createClient> | null {
  try {
    return createClient();
  } catch {
    return null;
  }
}

export function useRoomVoice({
  roomId,
  myUserId,
  peerUserIds,
  mode = "player",
}: UseRoomVoiceArgs): VoiceState {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<VoiceError>(null);
  const [listenersAllowed, setListenersAllowedState] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef(new Map<string, RTCPeerConnection>());
  const audiosRef = useRef(new Map<string, HTMLAudioElement>());
  const iceQueueRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const restartsRef = useRef(new Map<string, number>());
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE);
  const mutedRef = useRef(false);
  const listenersAllowedRef = useRef(false);
  const listenerLinksRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  // Keep the latest args in refs so realtime callbacks never go stale.
  const argsRef = useRef({ roomId, myUserId, peerUserIds, mode });
  argsRef.current = { roomId, myUserId, peerUserIds, mode };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const presenceState = useCallback((): Record<string, PresenceMeta[]> => {
    const ch = channelRef.current;
    if (!ch) return {};
    return ch.presenceState() as Record<string, PresenceMeta[]>;
  }, []);

  const presenceMeta = useCallback(
    (userId: string): PresenceMeta | undefined => presenceState()[userId]?.[0],
    [presenceState]
  );

  const peerPresent = useCallback(
    (peerId: string): boolean => peerId in presenceState(),
    [presenceState]
  );

  const updateListenerCount = useCallback(() => {
    if (argsRef.current.mode !== "player") return;
    const state = presenceState();
    let n = 0;
    for (const [key, metas] of Object.entries(state)) {
      if (key !== argsRef.current.myUserId && metas[0]?.role === "listener") n++;
    }
    if (mountedRef.current) setListenerCount(n);
  }, [presenceState]);

  const teardownPeer = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      pcsRef.current.delete(peerId);
    }
    const audio = audiosRef.current.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audiosRef.current.delete(peerId);
    }
    iceQueueRef.current.delete(peerId);
    listenerLinksRef.current.delete(peerId);
  }, []);

  /**
   * Player mode: status is "connected" once ANY seated-player link is
   * connected (listener links don't count), else "waiting".
   */
  const updatePeerStatus = useCallback(() => {
    if (!mountedRef.current) return;
    const any = [...pcsRef.current.entries()].some(
      ([peerId, pc]) =>
        !listenerLinksRef.current.has(peerId) &&
        pc.connectionState === "connected"
    );
    setStatus(any ? "connected" : "waiting");
  }, []);

  /** Listener mode: connected when at least one player stream is flowing. */
  const updateListenerStatus = useCallback(() => {
    if (!mountedRef.current) return;
    const any = [...pcsRef.current.values()].some(
      (pc) => pc.connectionState === "connected"
    );
    setStatus(any ? "connected" : "waiting");
  }, []);

  const drainIceQueue = useCallback(async (peerId: string) => {
    const pc = pcsRef.current.get(peerId);
    const queued = iceQueueRef.current.get(peerId);
    if (!pc || !queued) return;
    iceQueueRef.current.delete(peerId);
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        /* stale candidate; safe to drop */
      }
    }
  }, []);

  const attachRemoteAudio = useCallback((peerId: string, stream: MediaStream) => {
    let audio = audiosRef.current.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audiosRef.current.set(peerId, audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {
      /* autoplay blocked until a user gesture; the Join click counts as one */
    });
  }, []);

  const trackPresence = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const { mode: m } = argsRef.current;
    void ch
      .track({
        role: m === "player" ? "player" : "listener",
        listenAllowed: m === "player" ? listenersAllowedRef.current : false,
      } satisfies PresenceMeta)
      .catch(() => {
        /* presence track is best-effort */
      });
  }, []);

  /**
   * Build a peer connection with my microphone attached (player side).
   * `restartable` = this is my opponent link and I am the initiator, so a
   * failed link may be closed and re-offered. Listener links never restart
   * from the player side — the listener re-initiates on its own.
   */
  const createPlayerConnection = useCallback(
    (peerId: string, restartable: boolean): RTCPeerConnection | null => {
      const sb = sbClient();
      const local = localStreamRef.current;
      if (!sb || !local) return null;
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      for (const track of local.getAudioTracks()) pc.addTrack(track, local);

      pc.onicecandidate = (e) => {
        const ch = channelRef.current;
        if (e.candidate && ch) {
          ch.send({
            type: "broadcast",
            event: "ice",
            payload: {
              from: argsRef.current.myUserId,
              to: peerId,
              candidate: e.candidate.toJSON(),
            } satisfies SignalPayload,
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        attachRemoteAudio(peerId, stream);
      };

      pc.onconnectionstatechange = () => updatePeerStatus();

      if (restartable) {
        pc.oniceconnectionstatechange = () => {
          const { myUserId: me, peerUserIds: peers, mode: m } = argsRef.current;
          if (
            m === "player" &&
            (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") &&
            isInitiator(me, peerId) &&
            peers.includes(peerId) &&
            mountedRef.current &&
            peerPresent(peerId)
          ) {
            const restarts = restartsRef.current.get(peerId) ?? 0;
            if (restarts >= MAX_RESTARTS) {
              setError("conn");
              setStatus("error");
              return;
            }
            restartsRef.current.set(peerId, restarts + 1);
            // Recreate the connection and re-offer; the peer will answer.
            void (async () => {
              teardownPeer(peerId);
              const fresh = createPlayerConnection(peerId, true);
              if (!fresh) {
                setError("conn");
                setStatus("error");
                return;
              }
              pcsRef.current.set(peerId, fresh);
              const ch = channelRef.current;
              if (!ch) return;
              const offer = await fresh.createOffer();
              await fresh.setLocalDescription(offer);
              ch.send({
                type: "broadcast",
                event: "offer",
                payload: {
                  from: argsRef.current.myUserId,
                  to: peerId,
                  sdp: offer,
                } satisfies SignalPayload,
              });
            })();
          }
        };
      }

      return pc;
    },
    [attachRemoteAudio, peerPresent, teardownPeer, updatePeerStatus]
  );

  /** Listener side: recvonly connection toward one player. */
  const createListenerConnection = useCallback(
    (playerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.onicecandidate = (e) => {
        const ch = channelRef.current;
        if (e.candidate && ch) {
          ch.send({
            type: "broadcast",
            event: "ice",
            payload: {
              from: argsRef.current.myUserId,
              to: playerId,
              candidate: e.candidate.toJSON(),
            } satisfies SignalPayload,
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        attachRemoteAudio(playerId, stream);
      };

      pc.onconnectionstatechange = () => updateListenerStatus();

      pc.oniceconnectionstatechange = () => {
        if (
          (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") &&
          argsRef.current.mode === "listener" &&
          mountedRef.current
        ) {
          const restarts = restartsRef.current.get(playerId) ?? 0;
          const meta = presenceMeta(playerId);
          if (restarts < MAX_RESTARTS && meta?.role === "player" && meta?.listenAllowed) {
            restartsRef.current.set(playerId, restarts + 1);
            void (async () => {
              teardownPeer(playerId);
              const fresh = createListenerConnection(playerId);
              pcsRef.current.set(playerId, fresh);
              const offer = await fresh.createOffer();
              await fresh.setLocalDescription(offer);
              channelRef.current?.send({
                type: "broadcast",
                event: "offer",
                payload: {
                  from: argsRef.current.myUserId,
                  to: playerId,
                  sdp: offer,
                } satisfies SignalPayload,
              });
            })();
          } else {
            teardownPeer(playerId);
            updateListenerStatus();
          }
        }
      };

      return pc;
    },
    [attachRemoteAudio, presenceMeta, teardownPeer, updateListenerStatus]
  );

  const startOffer = useCallback(
    async (peerId: string) => {
      const { myUserId: me } = argsRef.current;
      if (!isInitiator(me, peerId) || pcsRef.current.has(peerId)) return;
      const pc = createPlayerConnection(peerId, true);
      if (!pc) return;
      pcsRef.current.set(peerId, pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "offer",
        payload: { from: me, to: peerId, sdp: offer } satisfies SignalPayload,
      });
    },
    [createPlayerConnection]
  );

  /** Listener side: offer to every present player that allows listening. */
  const offerToAllowedPlayers = useCallback(async () => {
    const { myUserId: me } = argsRef.current;
    const state = presenceState();
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas[0];
      if (key === me || pcsRef.current.has(key)) continue;
      if (meta?.role === "player" && meta?.listenAllowed) {
        const pc = createListenerConnection(key);
        pcsRef.current.set(key, pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channelRef.current?.send({
          type: "broadcast",
          event: "offer",
          payload: { from: me, to: key, sdp: offer } satisfies SignalPayload,
        });
      }
    }
  }, [createListenerConnection, presenceState]);

  const handleOffer = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      const { myUserId: me, mode: m } = argsRef.current;
      if (m === "listener") return; // listeners never receive offers; they initiate
      const meta = presenceMeta(from);
      if (meta?.role === "listener") {
        // Listener link: per-link authorization — a listener receives MY
        // audio only while I explicitly allow it.
        if (!listenersAllowedRef.current) return;
        let pc: RTCPeerConnection | null | undefined = pcsRef.current.get(from);
        if (!pc) {
          pc = createPlayerConnection(from, false);
          if (!pc) return;
          pcsRef.current.set(from, pc);
          listenerLinksRef.current.add(from);
        } else {
          listenerLinksRef.current.add(from);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await drainIceQueue(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channelRef.current?.send({
          type: "broadcast",
          event: "answer",
          payload: { from: me, to: from, sdp: answer } satisfies SignalPayload,
        });
        return;
      }
      // Player↔player link: only the smaller id offers.
      if (isInitiator(me, from)) return;
      let pc: RTCPeerConnection | null | undefined = pcsRef.current.get(from);
      if (!pc) {
        pc = createPlayerConnection(from, false);
        if (!pc) return;
        pcsRef.current.set(from, pc);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await drainIceQueue(from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      channelRef.current?.send({
        type: "broadcast",
        event: "answer",
        payload: { from: me, to: from, sdp: answer } satisfies SignalPayload,
      });
    },
    [createPlayerConnection, drainIceQueue, presenceMeta]
  );

  const handleAnswer = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      const { mode: m } = argsRef.current;
      const pc = pcsRef.current.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await drainIceQueue(from);
      if (m === "listener") updateListenerStatus();
      else updatePeerStatus();
    },
    [drainIceQueue, updateListenerStatus, updatePeerStatus]
  );

  const handleIce = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const pc = pcsRef.current.get(from);
      if (!pc) {
        const queued = iceQueueRef.current.get(from) ?? [];
        queued.push(candidate);
        iceQueueRef.current.set(from, queued);
        return;
      }
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          /* stale candidate */
        }
      } else {
        const queued = iceQueueRef.current.get(from) ?? [];
        queued.push(candidate);
        iceQueueRef.current.set(from, queued);
      }
    },
    []
  );

  const teardownAll = useCallback(() => {
    for (const peerId of [...pcsRef.current.keys()]) teardownPeer(peerId);
    restartsRef.current.clear();
    listenerLinksRef.current.clear();
    const local = localStreamRef.current;
    if (local) {
      for (const track of local.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      localStreamRef.current = null;
    }
    const ch = channelRef.current;
    channelRef.current = null;
    const sb = sbClient();
    if (ch) {
      try {
        void ch.untrack();
      } catch {
        /* best effort */
      }
      if (sb) {
        try {
          void sb.removeChannel(ch);
        } catch {
          /* best effort */
        }
      }
    }
    setMuted(false);
    mutedRef.current = false;
    listenersAllowedRef.current = false;
    setListenersAllowedState(false);
    setListenerCount(0);
  }, [teardownPeer]);

  const leave = useCallback(() => {
    const { myUserId: me } = argsRef.current;
    channelRef.current?.send({
      type: "broadcast",
      event: "bye",
      payload: { from: me, to: "" } satisfies SignalPayload,
    });
    teardownAll();
    if (mountedRef.current) {
      setJoined(false);
      setStatus("idle");
      setError(null);
    }
  }, [teardownAll]);

  /** Player mode: toggle spectator listening consent. */
  const setListenersAllowed = useCallback(
    (v: boolean) => {
      if (argsRef.current.mode !== "player") return;
      const { myUserId: me } = argsRef.current;
      listenersAllowedRef.current = v;
      setListenersAllowedState(v);
      trackPresence();
      if (!v) {
        // Revoke immediately: close every listener link and notify each listener.
        const ch = channelRef.current;
        for (const listenerId of [...listenerLinksRef.current]) {
          ch?.send({
            type: "broadcast",
            event: "bye",
            payload: { from: me, to: listenerId } satisfies SignalPayload,
          });
          teardownPeer(listenerId);
        }
        updateListenerCount();
      }
    },
    [teardownPeer, trackPresence, updateListenerCount]
  );

  const join = useCallback(() => {
    const { roomId: rid, myUserId: me, peerUserIds: peers, mode: m } = argsRef.current;
    const sb = sbClient();
    if (!sb || (m === "player" && peers.length === 0)) {
      setError("conn");
      setStatus("error");
      return;
    }
    if (channelRef.current) return; // already joining/joined
    setError(null);
    setStatus("connecting");

    (async () => {
      // 1. Microphone (players only) — no mic, no voice.
      if (m === "player") {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
        } catch {
          if (mountedRef.current) {
            setError("mic");
            setStatus("error");
          }
          return;
        }
        localStreamRef.current = stream;
        for (const track of stream.getAudioTracks()) track.enabled = !mutedRef.current;
      }

      // 2. TURN credentials; any failure degrades to the STUN-only list.
      try {
        const { data } = (await sb.auth.getSession()) || { data: null };
        const token = data.session?.access_token;
        if (token) {
          const res = await fetch("/api/voice/turn-credentials", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const json = (await res.json()) as { iceServers?: RTCIceServer[] };
            if (Array.isArray(json.iceServers) && json.iceServers.length > 0) {
              iceServersRef.current = json.iceServers;
            }
          }
        }
      } catch {
        /* STUN-only fallback already set */
      }

      if (!mountedRef.current) {
        const local = localStreamRef.current;
        if (local) for (const t of local.getTracks()) t.stop();
        return;
      }

      // 3. Dedicated voice signaling channel (never the postgres_changes channel).
      const ch = sb.channel(CHANNEL_PREFIX + rid, {
        config: {
          broadcast: { self: false },
          presence: { key: me },
        },
      });

      ch.on("broadcast", { event: "offer" }, ({ payload }: { payload: unknown }) => {
        const p = payload as SignalPayload;
        if (p.to !== me || !p.sdp) return;
        void handleOffer(p.from, p.sdp);
      });
      ch.on("broadcast", { event: "answer" }, ({ payload }: { payload: unknown }) => {
        const p = payload as SignalPayload;
        if (p.to !== me || !p.sdp) return;
        void handleAnswer(p.from, p.sdp);
      });
      ch.on("broadcast", { event: "ice" }, ({ payload }: { payload: unknown }) => {
        const p = payload as SignalPayload;
        if (p.to !== me || !p.candidate) return;
        void handleIce(p.from, p.candidate);
      });
      ch.on("broadcast", { event: "bye" }, ({ payload }: { payload: unknown }) => {
        const p = payload as SignalPayload;
        // "bye" is sent broadcast-style: to "" = everyone, or addressed.
        if (p.to !== "" && p.to !== me) return;
        teardownPeer(p.from);
        if (argsRef.current.mode === "listener") updateListenerStatus();
        else updatePeerStatus();
        updateListenerCount();
      });

      const onPresenceChange = () => {
        if (!mountedRef.current) return;
        updateListenerCount();
        if (argsRef.current.mode === "listener") {
          void offerToAllowedPlayers();
        } else {
          // Every seated player links to every OTHER seated player.
          const { peerUserIds: peers } = argsRef.current;
          for (const pid of peers) {
            if (peerPresent(pid) && !pcsRef.current.has(pid)) {
              void startOffer(pid);
            }
          }
        }
      };
      ch.on("presence", { event: "sync" }, onPresenceChange);
      ch.on("presence", { event: "join" }, onPresenceChange);
      ch.on("presence", { event: "leave" }, ({ key }: { key: string }) => {
        teardownPeer(key);
        if (argsRef.current.mode === "listener") updateListenerStatus();
        else updatePeerStatus();
        updateListenerCount();
      });

      channelRef.current = ch;
      ch.subscribe(async (s: string) => {
        if (s === "SUBSCRIBED") {
          trackPresence();
          if (mountedRef.current) {
            setJoined(true);
            setStatus("waiting");
          }
          onPresenceChange();
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          if (mountedRef.current) {
            setError("conn");
            setStatus("error");
          }
        }
      });
    })().catch(() => {
      if (mountedRef.current) {
        setError("conn");
        setStatus("error");
      }
    });
  }, [
    handleAnswer,
    handleIce,
    handleOffer,
    offerToAllowedPlayers,
    peerPresent,
    startOffer,
    teardownPeer,
    trackPresence,
    updateListenerCount,
    updateListenerStatus,
    updatePeerStatus,
  ]);

  const toggleMute = useCallback(() => {
    if (argsRef.current.mode !== "player") return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    const local = localStreamRef.current;
    if (local) {
      for (const track of local.getAudioTracks()) track.enabled = !next;
    }
    setMuted(next);
  }, []);

  // Full teardown when the component unmounts.
  useEffect(() => {
    return () => {
      teardownAll();
    };
  }, [teardownAll]);

  return {
    status,
    joined,
    muted,
    error,
    join,
    leave,
    toggleMute,
    listenersAllowed,
    setListenersAllowed,
    listenerCount,
  };
}
