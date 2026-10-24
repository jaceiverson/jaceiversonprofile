/*
 * Opt-in voice chat for the online games (games/rook.html, games/super-tic-tac-toe.html).
 *
 * Audio goes browser to browser over the PeerJS peer the game already uses, so there's no server
 * of our own. Everyone in voice is connected to everyone else in voice (a full mesh, which is fine
 * for up to four players). For each pair, the player with the smaller peer ID places the call, so
 * nobody gets called twice.
 *
 * The page creates one GameVoice, attaches it to each Peer it makes, and tells it who else is in
 * voice with sync(). onChange fires whenever something worth redrawing changes (joined, muted,
 * someone started or stopped talking).
 */
(function () {
  const SPEAKING_LEVEL = 0.03;   // RMS level (0–1) that counts as talking
  const LEVEL_POLL_MS = 150;
  const RETRY_MS = 2000;         // re-dial a dropped call this long after it closes
  const ME = 'me';

  class GameVoice {
    constructor({ onChange = () => {} } = {}) {
      this.onChange = onChange;
      this.peer = null;
      this.stream = null;          // our microphone, while in voice
      this.muted = false;
      this.wanted = [];            // peer IDs of the other players in voice
      this.calls = new Map();      // peer ID -> { call, audio }
      this.meters = new Map();     // peer ID (or ME) -> AnalyserNode
      this.speaking = new Set();   // peer IDs (or ME) talking right now
      this.ctx = null;
      this.timer = null;
    }

    static supported() {
      return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    }

    get joined() { return !!this.stream; }

    // Who is talking: pass a peer ID, or nothing for yourself
    isSpeaking(id = ME) { return this.speaking.has(id); }

    // Call this for every Peer the page creates, so incoming voice calls get answered
    attach(peer) {
      this.peer = peer;
      peer.on('call', call => this._answer(call));
    }

    // Asks for the microphone; throws an Error with a friendly message if it can't
    async join() {
      if (this.joined) return;
      if (!GameVoice.supported()) throw new Error("Voice chat isn't available in this browser (it needs a secure https page).");
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
      } catch (e) {
        if (e && e.name === 'NotAllowedError') throw new Error('Microphone access is blocked. Allow it in your browser settings for this site, then try again.');
        if (e && e.name === 'NotFoundError') throw new Error('No microphone found.');
        throw new Error(`Couldn't start the microphone (${(e && (e.name || e.message)) || 'unknown error'}).`);
      }
      this.muted = false;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.ctx.resume().catch(() => {});
        this._meter(ME, this.stream);
        this.timer = setInterval(() => this._pollLevels(), LEVEL_POLL_MS);
      }
      this._reconcile();
      this.onChange();
    }

    leave() {
      for (const id of [...this.calls.keys()]) this._hangUp(id);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.muted = false;
      clearInterval(this.timer);
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = null;
      this.meters.clear();
      this.speaking.clear();
      this.onChange();
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
      if (muted) this.speaking.delete(ME);
      this.onChange();
    }

    // ids: peer IDs of the other players who are in voice right now
    sync(ids) {
      this.wanted = ids.filter(Boolean);
      this._reconcile();
    }

    // Hang up on anyone who left voice; call anyone new (when it's our job to place the call)
    _reconcile() {
      if (!this.joined || !this.peer || !this.peer.id) return;
      for (const id of [...this.calls.keys()]) {
        if (!this.wanted.includes(id)) this._hangUp(id);
      }
      for (const id of this.wanted) {
        if (this.calls.has(id) || this.peer.id > id) continue;
        const call = this.peer.call(id, this.stream);
        if (call) this._track(call);
      }
    }

    _answer(call) {
      if (!this.joined) { call.close(); return; }
      if (this.calls.has(call.peer)) this._hangUp(call.peer);
      call.answer(this.stream);
      this._track(call);
    }

    _track(call) {
      const id = call.peer;
      const entry = { call, audio: null };
      this.calls.set(id, entry);

      call.on('stream', remote => {
        if (this.calls.get(id) !== entry) return;
        if (!entry.audio) {
          // Kept in the page (hidden) so phones are happy to play it
          entry.audio = document.createElement('audio');
          entry.audio.autoplay = true;
          entry.audio.setAttribute('playsinline', '');
          entry.audio.hidden = true;
          document.body.appendChild(entry.audio);
        }
        if (entry.audio.srcObject !== remote) {
          entry.audio.srcObject = remote;
          entry.audio.play().catch(() => {});
          this._meter(id, remote);
        }
        this.onChange();
      });

      const dropped = () => {
        if (this.calls.get(id) !== entry) return;
        this._hangUp(id);
        this.onChange();
        setTimeout(() => this._reconcile(), RETRY_MS);   // still wanted? dial again
      };
      call.on('close', dropped);
      call.on('error', dropped);
    }

    _hangUp(id) {
      const entry = this.calls.get(id);
      if (!entry) return;
      this.calls.delete(id);
      try { entry.call.close(); } catch (e) { /* already closed */ }
      if (entry.audio) {
        entry.audio.srcObject = null;
        entry.audio.remove();
      }
      this.meters.delete(id);
      this.speaking.delete(id);
    }

    _meter(id, stream) {
      if (!this.ctx) return;
      try {
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;
        this.ctx.createMediaStreamSource(stream).connect(analyser);
        this.meters.set(id, analyser);
      } catch (e) { /* no level meter for this one; voice still works */ }
    }

    _pollLevels() {
      const buf = new Float32Array(512);
      let changed = false;
      for (const [id, analyser] of this.meters) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) sum += x * x;
        const talking = Math.sqrt(sum / buf.length) > SPEAKING_LEVEL && !(id === ME && this.muted);
        if (talking !== this.speaking.has(id)) {
          changed = true;
          if (talking) this.speaking.add(id);
          else this.speaking.delete(id);
        }
      }
      if (changed) this.onChange();
    }
  }

  window.GameVoice = GameVoice;
})();
