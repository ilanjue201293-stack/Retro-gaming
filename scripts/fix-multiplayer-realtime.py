from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

# ---------------- Pong ----------------
p = Path("app/PongGame.tsx")
text = p.read_text()
text = replace_once(text,
'''  const reconnectingRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);''',
'''  const reconnectingRef = useRef<Set<string>>(new Set());
  const directAckRef = useRef<Map<string, number>>(new Map());
  const lastDirectStateAtRef = useRef(0);
  const draggingRef = useRef(false);''',
"pong realtime refs")
text = replace_once(text,
'''      peersRef.current.delete(peerId);
    }
    reconnectingRef.current.delete(peerId);''',
'''      peersRef.current.delete(peerId);
    }
    directAckRef.current.delete(peerId);
    reconnectingRef.current.delete(peerId);''',
"pong close peer ack")
text = replace_once(text,
'''    pendingIceRef.current.clear();
    reconnectingRef.current.clear();''',
'''    pendingIceRef.current.clear();
    directAckRef.current.clear();
    lastDirectStateAtRef.current = 0;
    reconnectingRef.current.clear();''',
"pong close all health")
old = '''  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId);
    if (entry) entry.dc = channel;
    channel.onopen = () => {
      reconnectingRef.current.delete(peerId);
      if (hostSide && simulationRef.current && channel.readyState === "open") {
        try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {}
      }
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (hostSide && message.type === "input") receiveInput(peerId, message.input);
        else if (!hostSide && message.type === "state") receiveState(message.state);
      } catch {}
    };
    channel.onclose = () => closePeer(peerId);
  }, [closePeer, receiveInput, receiveState]);'''
new = '''  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId);
    if (entry) entry.dc = channel;
    channel.onopen = () => {
      reconnectingRef.current.delete(peerId);
      if (hostSide) directAckRef.current.set(peerId, performance.now());
      else lastDirectStateAtRef.current = performance.now();
      if (hostSide && simulationRef.current && channel.readyState === "open") {
        try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {}
      }
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (hostSide && message.type === "input") receiveInput(peerId, message.input);
        else if (hostSide && message.type === "ack") directAckRef.current.set(peerId, performance.now());
        else if (!hostSide && message.type === "state") {
          lastDirectStateAtRef.current = performance.now();
          receiveState(message.state);
          if (channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "ack" })); } catch {} }
        }
      } catch {}
    };
    channel.onclose = () => closePeer(peerId);
  }, [closePeer, receiveInput, receiveState]);'''
text = replace_once(text, old, new, "pong channel watchdog")
text = replace_once(text,
'''    const old = peersRef.current.get(peerId);
    if (old?.dc?.readyState === "open" || old?.pc.connectionState === "connecting") return;''',
'''    const old = peersRef.current.get(peerId);
    const ackAge = performance.now() - (directAckRef.current.get(peerId) ?? 0);
    if (old?.dc?.readyState === "open" && ackAge < 1600) return;
    if (old?.pc.connectionState === "connecting") return;''',
"pong stale peer reconnect")
text = replace_once(text,
'''      const channel = entry.pc.createDataChannel("retro-pong");''',
'''      const channel = entry.pc.createDataChannel("retro-pong", { ordered: false, maxRetransmits: 0 });''',
"pong realtime channel mode")
text = replace_once(text,
'''      const peer = peersRef.current.get(isHost ? (gameRef.current?.players.find((p) => p.userId !== user.id && !p.isBot)?.userId ?? "") : room.hostId);
      timer = window.setTimeout(() => void signalPoll(), peer?.dc?.readyState === "open" ? 700 : 90);''',
'''      const peerId = isHost ? (gameRef.current?.players.find((p) => p.userId !== user.id && !p.isBot)?.userId ?? "") : room.hostId;
      const peer = peersRef.current.get(peerId);
      const healthy = isHost
        ? peer?.dc?.readyState === "open" && performance.now() - (directAckRef.current.get(peerId) ?? 0) < 1200
        : peer?.dc?.readyState === "open" && performance.now() - lastDirectStateAtRef.current < 1200;
      timer = window.setTimeout(() => void signalPoll(), healthy ? 700 : 120);''',
"pong signal watchdog")
text = replace_once(text,
'''          if (peersRef.current.get(player.userId)?.dc?.readyState !== "open") void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined);''',
'''          const channel = peersRef.current.get(player.userId)?.dc;
          const healthy = channel?.readyState === "open" && now - (directAckRef.current.get(player.userId) ?? 0) < 900;
          if (!healthy) void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined);''',
"pong fallback health")
text = text.replace("if (now - simulation.lastFallbackBroadcast >= 170)", "if (now - simulation.lastFallbackBroadcast >= 150)")
old = '''    if (channel?.readyState === "open") {
      if (force || now - lastDirectInputRef.current >= 12) {
        lastDirectInputRef.current = now;
        try { channel.send(JSON.stringify({ type: "input", input: { y: localYRef.current } })); } catch {}
      }
      return;
    }
    if (force || now - lastFallbackInputRef.current >= 85) {'''
new = '''    const directHealthy = channel?.readyState === "open" && now - lastDirectStateAtRef.current < 1200;
    if (channel?.readyState === "open") {
      if (force || now - lastDirectInputRef.current >= 12) {
        lastDirectInputRef.current = now;
        try { channel.send(JSON.stringify({ type: "input", input: { y: localYRef.current } })); } catch {}
      }
      if (directHealthy) return;
    }
    if (force || now - lastFallbackInputRef.current >= 100) {'''
text = replace_once(text, old, new, "pong input fallback watchdog")
text = replace_once(text,
'''        timer = window.setTimeout(() => void pollState(), next.status === "lobby" ? 360 : 1200);''',
'''        timer = window.setTimeout(() => void pollState(), next.status === "lobby" ? 1100 : 2600);''',
"pong poll pressure")
text = replace_once(text,
'''        timer = window.setTimeout(() => void pollState(), 1000);''',
'''        timer = window.setTimeout(() => void pollState(), 1600);''',
"pong error poll pressure")
p.write_text(text)

# ---------------- Hockey ----------------
p = Path("app/HockeyGame.tsx")
text = p.read_text()
text = replace_once(text,
'''  const remoteSnapshotRef = useRef<{ frame: Frame; receivedAt: number } | null>(null);
  const reconnectingRef = useRef<Set<string>>(new Set());''',
'''  const remoteSnapshotRef = useRef<{ frame: Frame; receivedAt: number } | null>(null);
  const reconnectingRef = useRef<Set<string>>(new Set());
  const directAckRef = useRef<Map<string, number>>(new Map());
  const lastDirectStateAtRef = useRef(0);''',
"hockey realtime refs")
text = replace_once(text,
'''    if (entry) { try { entry.dc?.close(); } catch {} try { entry.pc.close(); } catch {} peersRef.current.delete(peerId); }
    reconnectingRef.current.delete(peerId);''',
'''    if (entry) { try { entry.dc?.close(); } catch {} try { entry.pc.close(); } catch {} peersRef.current.delete(peerId); }
    directAckRef.current.delete(peerId);
    reconnectingRef.current.delete(peerId);''',
"hockey close peer ack")
text = replace_once(text,
'''  const closeAllPeers = useCallback(() => { for (const peerId of [...peersRef.current.keys()]) closePeer(peerId); pendingIceRef.current.clear(); reconnectingRef.current.clear(); }, [closePeer]);''',
'''  const closeAllPeers = useCallback(() => { for (const peerId of [...peersRef.current.keys()]) closePeer(peerId); pendingIceRef.current.clear(); directAckRef.current.clear(); lastDirectStateAtRef.current = 0; reconnectingRef.current.clear(); }, [closePeer]);''',
"hockey close all health")
old = '''  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId); if (entry) entry.dc = channel; channel.binaryType = "arraybuffer";
    channel.onopen = () => { reconnectingRef.current.delete(peerId); if (hostSide && simulationRef.current && channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {} } };
    channel.onmessage = (event) => { try { const message = JSON.parse(String(event.data)); if (hostSide && message.type === "input") receiveInput(peerId, message.input); else if (!hostSide && message.type === "state") receiveState(message.state); } catch {} };
    channel.onclose = () => closePeer(peerId); channel.onerror = () => undefined;
  }, [closePeer, receiveInput, receiveState]);'''
new = '''  const attachDataChannel = useCallback((peerId: string, channel: RTCDataChannel, hostSide: boolean) => {
    const entry = peersRef.current.get(peerId); if (entry) entry.dc = channel; channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      reconnectingRef.current.delete(peerId);
      if (hostSide) directAckRef.current.set(peerId, performance.now()); else lastDirectStateAtRef.current = performance.now();
      if (hostSide && simulationRef.current && channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "state", state: simulationRef.current.frame })); } catch {} }
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (hostSide && message.type === "input") receiveInput(peerId, message.input);
        else if (hostSide && message.type === "ack") directAckRef.current.set(peerId, performance.now());
        else if (!hostSide && message.type === "state") {
          lastDirectStateAtRef.current = performance.now(); receiveState(message.state);
          if (channel.readyState === "open") { try { channel.send(JSON.stringify({ type: "ack" })); } catch {} }
        }
      } catch {}
    };
    channel.onclose = () => closePeer(peerId); channel.onerror = () => undefined;
  }, [closePeer, receiveInput, receiveState]);'''
text = replace_once(text, old, new, "hockey channel watchdog")
text = replace_once(text,
'''    const existing = peersRef.current.get(peerId); if (existing?.dc?.readyState === "open" || existing?.pc.connectionState === "connecting") return;''',
'''    const existing = peersRef.current.get(peerId); const ackAge = performance.now() - (directAckRef.current.get(peerId) ?? 0); if (existing?.dc?.readyState === "open" && ackAge < 1600) return; if (existing?.pc.connectionState === "connecting") return;''',
"hockey stale peer reconnect")
text = replace_once(text,
'''const channel = entry.pc.createDataChannel("retro-hockey");''',
'''const channel = entry.pc.createDataChannel("retro-hockey", { ordered: false, maxRetransmits: 0 });''',
"hockey realtime channel mode")
old = '''      const current = gameRef.current; let directReady = false;
      if (current && current.status !== "lobby") { if (room.hostId === user.id) { const remotes = current.players.filter((player) => player.userId !== user.id && !player.isBot); directReady = remotes.length > 0 && remotes.every((player) => peersRef.current.get(player.userId)?.dc?.readyState === "open"); } else directReady = peersRef.current.get(room.hostId)?.dc?.readyState === "open"; }
      timer = window.setTimeout(() => void signalPoll(), directReady ? 700 : 90);'''
new = '''      const current = gameRef.current; let directReady = false; const now = performance.now();
      if (current && current.status !== "lobby") {
        if (room.hostId === user.id) {
          const remotes = current.players.filter((player) => player.userId !== user.id && !player.isBot);
          directReady = remotes.length > 0 && remotes.every((player) => peersRef.current.get(player.userId)?.dc?.readyState === "open" && now - (directAckRef.current.get(player.userId) ?? 0) < 1200);
        } else directReady = peersRef.current.get(room.hostId)?.dc?.readyState === "open" && now - lastDirectStateAtRef.current < 1200;
      }
      timer = window.setTimeout(() => void signalPoll(), directReady ? 700 : 120);'''
text = replace_once(text, old, new, "hockey signal watchdog")
old = '''      if (now - simulation.lastFallbackBroadcast >= 170) { simulation.lastFallbackBroadcast = now; for (const player of current.players) { if (player.userId === user.id || player.isBot) continue; const channel = peersRef.current.get(player.userId)?.dc; if (channel?.readyState !== "open") void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined); } }'''
new = '''      if (now - simulation.lastFallbackBroadcast >= 150) { simulation.lastFallbackBroadcast = now; for (const player of current.players) { if (player.userId === user.id || player.isBot) continue; const channel = peersRef.current.get(player.userId)?.dc; const healthy = channel?.readyState === "open" && now - (directAckRef.current.get(player.userId) ?? 0) < 900; if (!healthy) void sendSignal(player.userId, "state", simulation.frame).catch(() => undefined); } }'''
text = replace_once(text, old, new, "hockey fallback health")
old = '''    if (channel?.readyState === "open") { if (force || now - lastDirectInputSendRef.current >= 12) { lastDirectInputSendRef.current = now; try { channel.send(JSON.stringify({ type: "input", input: packet })); } catch {} } return; }
    if (force || now - lastFallbackInputSendRef.current >= 85) {'''
new = '''    const directHealthy = channel?.readyState === "open" && now - lastDirectStateAtRef.current < 1200;
    if (channel?.readyState === "open") { if (force || now - lastDirectInputSendRef.current >= 12) { lastDirectInputSendRef.current = now; try { channel.send(JSON.stringify({ type: "input", input: packet })); } catch {} } if (directHealthy) return; }
    if (force || now - lastFallbackInputSendRef.current >= 100) {'''
text = replace_once(text, old, new, "hockey input fallback watchdog")
text = replace_once(text,
'''const delay = current?.status === "playing" ? 1200 : 320;''',
'''const delay = current?.status === "playing" ? 2600 : 1100;''',
"hockey poll pressure")
text = replace_once(text,
'''timer = window.setTimeout(() => void poll(), current?.status === "playing" ? 2200 : 900);''',
'''timer = window.setTimeout(() => void poll(), current?.status === "playing" ? 3200 : 1600);''',
"hockey error poll pressure")
p.write_text(text)

# ---------------- Reduce background polling ----------------
p = Path("app/RpsGame.tsx")
text = p.read_text()
text = replace_once(text, 'const id = window.setInterval(poll, game?.status === "playing" ? 160 : 600);', 'const id = window.setInterval(poll, game?.status === "playing" ? 220 : 1100);', 'rps poll pressure')
p.write_text(text)

p = Path("app/DunkshotGame.tsx")
text = p.read_text()
text = replace_once(text, 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 280 : 900);', 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 350 : 1400);', 'dunkshot poll pressure')
p.write_text(text)

p = Path("app/PoolGame.tsx")
text = p.read_text()
text = replace_once(text, 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 280 : 1000);', 'if (alive) timer = window.setTimeout(() => void poll(), duelActive ? 350 : 1400);', 'pool poll pressure')
p.write_text(text)

print("Realtime multiplayer network repair applied")
