import type { SessionMessage, SessionRole } from "./types";

/**
 * Peer-to-peer video, so each person can see the other while posing.
 *
 * Signalling rides the realtime channel that already exists — WebRTC needs a way to
 * exchange SDP and ICE candidates before it can connect, and that is exactly what a
 * broadcast channel is for. No second service.
 *
 * **The host always offers.** Deciding by role rather than by whoever is ready first
 * removes "glare" entirely: two peers offering simultaneously is the classic WebRTC
 * failure, and it needs rollback negotiation to recover from. With a fixed offerer
 * the situation cannot arise.
 *
 * This is deliberately additive. Capture does not depend on it — if the connection
 * never establishes, the countdown still fires and the card is still produced. The
 * preview is the thing that degrades, not the product.
 */

/**
 * Public STUN only. STUN is enough to discover a public address and works for most
 * home networks.
 *
 * There is no TURN server, which means **symmetric NATs and restrictive corporate
 * networks will fail to connect**. Relaying media needs a server that carries the
 * traffic, which costs money and is hard to justify for a feature that only makes
 * posing easier. Failure is handled by showing a placeholder rather than blocking.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export type PeerVideoState =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export interface PeerVideoOptions {
  isHost: boolean;
  role: SessionRole;
  send: (msg: SessionMessage) => void;
  onStream: (stream: MediaStream | null) => void;
  onState: (state: PeerVideoState) => void;
}

export class PeerVideo {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  /** ICE candidates that arrived before a remote description existed to attach them to. */
  private pendingIce: RTCIceCandidateInit[] = [];
  /** An offer that arrived before this device had a camera to answer with. */
  private pendingOffer: string | null = null;
  private closed = false;

  constructor(private opts: PeerVideoOptions) {}

  /** Attach the local camera and, if host, begin negotiating. */
  async start(localStream: MediaStream) {
    if (this.closed) return;
    this.localStream = localStream;

    if (!this.pc) this.createConnection();
    const pc = this.pc;
    if (!pc) return;

    // Add tracks once. Re-adding on a later call would trigger renegotiation for no
    // reason, and the stream identity does not change while a session is live.
    if (pc.getSenders().length === 0) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    if (this.pendingOffer) {
      const sdp = this.pendingOffer;
      this.pendingOffer = null;
      await this.acceptOffer(sdp);
      return;
    }

    if (this.opts.isHost) await this.offer();
  }

  private createConnection() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.opts.onState("connecting");

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.opts.send({
        type: "rtc-ice",
        from: this.opts.role,
        candidate: e.candidate.toJSON(),
      });
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) this.opts.onStream(stream);
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          this.opts.onState("connected");
          break;
        case "failed":
          this.opts.onState("failed");
          this.opts.onStream(null);
          break;
        case "disconnected":
          this.opts.onState("connecting");
          break;
        case "closed":
          this.opts.onState("closed");
          this.opts.onStream(null);
          break;
      }
    };
  }

  private async offer() {
    const pc = this.pc;
    if (!pc) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (offer.sdp) {
      this.opts.send({ type: "rtc-offer", from: this.opts.role, sdp: offer.sdp });
    }
  }

  private async acceptOffer(sdp: string) {
    const pc = this.pc;
    if (!pc) return;

    await pc.setRemoteDescription({ type: "offer", sdp });
    await this.drainIce();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp) {
      this.opts.send({ type: "rtc-answer", from: this.opts.role, sdp: answer.sdp });
    }
  }

  private async drainIce() {
    const pc = this.pc;
    if (!pc) return;

    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate).catch(() => {
        /* A candidate that no longer applies is not worth failing the connection. */
      });
    }
  }

  /** Feed a signalling message addressed to this peer. */
  async handleSignal(msg: SessionMessage) {
    if (this.closed) return;

    if (msg.type === "rtc-offer") {
      if (this.opts.isHost) return; // the host offers; it never accepts one
      if (!this.localStream) {
        // Answering before our camera exists would negotiate a one-way connection.
        this.pendingOffer = msg.sdp;
        return;
      }
      if (!this.pc) this.createConnection();
      if (this.pc && this.pc.getSenders().length === 0 && this.localStream) {
        for (const track of this.localStream.getTracks()) {
          this.pc.addTrack(track, this.localStream);
        }
      }
      await this.acceptOffer(msg.sdp);
      return;
    }

    if (msg.type === "rtc-answer") {
      const pc = this.pc;
      // Only meaningful while we are waiting on one; a duplicate would throw.
      if (!pc || pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      await this.drainIce();
      return;
    }

    if (msg.type === "rtc-ice") {
      const pc = this.pc;
      // Candidates routinely arrive before the description they belong to; holding
      // them is normal operation, not an error path.
      if (!pc || !pc.remoteDescription) {
        this.pendingIce.push(msg.candidate);
        return;
      }
      await pc.addIceCandidate(msg.candidate).catch(() => {});
    }
  }

  /** Re-offer, e.g. after the peer reloads. Host only. */
  async renegotiate() {
    if (!this.opts.isHost || !this.pc || !this.localStream) return;
    await this.offer();
  }

  stop() {
    this.closed = true;
    this.pendingIce = [];
    this.pendingOffer = null;

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }

    this.opts.onStream(null);
    this.opts.onState("closed");
  }
}
