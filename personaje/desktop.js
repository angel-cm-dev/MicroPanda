// MicroPanda — modo escritorio: conexión con la app (app/preload.js).
// Usa lo definido en index.html: $, setMood, mood, MOODS, setPointer, applyMouth, talkLevel.
if (DESKTOP && window.micropanda) {
  const api = window.micropanda;
  const svg = $('panda');
  const q = $('q'), replyEl = $('reply'), confirmBox = $('confirmBox'), micBtn = $('mic');
  const micDot = $('micDot');
  let voiceInfo = { stt: false, tts: false, wakeWord: false, sensitivity: 'normal', micId: '', followUp: true, beep: true };
  let chatOpen = false, closeTimer = 0, moodTimer = 0;
  let rec = null, player = null, speaking = false, busy = false, lastTalkAt = 0;
  let voiceTurn = false;      // la conversación empezó por voz: responde y sigue escuchando
  let awaitingConfirm = false;
  const gesture = (g) => window.gesture?.(g);
  const dot = () => micDot.className = voiceInfo.micMuted ? 'muted' : rec ? 'rec' : wake ? 'on' : '';

  // ---------- el cursor y el ánimo que decide el cerebro (app/brain.js) ----------
  api.onCursor(({ x, y }) => {
    setPointer(x, y);
    if (mood === 'sleepy' && autoSlept) { autoSlept = false; setMood('idle'); }
  });

  let autoSlept = false;
  api.onMood(({ mood: m, ms, say: text, manual, alert, gesture: g }) => {
    if (g) gesture(g);
    if (manual) { clearTimeout(moodTimer); autoSlept = false; return setMood(m); }
    // recordatorio: avisa siempre, con globo y en voz alta
    if (alert) {
      autoSlept = false;
      react(m, ms || 8000);
      notice(text);
      keepOpen(20000);
      say(text);
      return;
    }
    // no interrumpe mientras conversan
    if (chatOpen || rec || speaking || busy || performance.now() - lastTalkAt < 15000) return;
    clearTimeout(moodTimer);
    autoSlept = m === 'sleepy' && !ms;
    setMood(m);
    if (ms) moodTimer = setTimeout(() => { if (mood === m) setMood('idle'); }, ms);
    if (text) notice(text);
  });

  function react(m, ms) {
    clearTimeout(moodTimer);
    setMood(m);
    moodTimer = setTimeout(() => { if (mood === m) setMood('idle'); }, ms);
  }

  // ---------- arrastrar para mover; un clic lo pone feliz ----------
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.screenX, y: e.screenY, moved: 0 };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
    if (dx || dy) { api.move(dx, dy); drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.screenX; drag.y = e.screenY; }
  });
  svg.addEventListener('pointerup', () => {
    if (drag && drag.moved < 4) { react('happy', 2500); api.poke(); }
    drag = null;
  });
  addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });

  // ---------- globo de diálogo ----------
  function keepOpen(ms = 25000) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!q.value && confirmBox.hidden && !rec && !speaking) closeChat(); }, ms);
  }
  function openChat(focus = true) {
    if (!chatOpen) {
      chatOpen = true;
      api.setChatOpen(true);
      document.body.classList.add('chat-open');
      if (!replyEl.textContent) replyEl.textContent = '¡Hola! 🐼 ¿Qué hago por ti? Escribe "ayuda" para ver lo que sé hacer.';
    }
    if (focus) setTimeout(() => q.focus(), 60);
    keepOpen();
  }
  function closeChat() {
    chatOpen = false;
    document.body.classList.remove('chat-open');
    api.setChatOpen(false);
  }
  // aviso espontáneo del cerebro: se muestra sin quitarte el foco y se cierra solo
  function notice(text) {
    openChat(false);
    replyEl.textContent = text;
    confirmBox.hidden = true;
    keepOpen(9000);
  }
  async function showResult(r) {
    busy = false;
    lastTalkAt = performance.now();
    replyEl.textContent = r.reply;
    confirmBox.hidden = !r.confirm;
    awaitingConfirm = !!r.confirm;
    q.disabled = !!r.confirm;
    clearTimeout(moodTimer);
    if (r.mood) setMood(r.mood);
    if (!r.confirm && r.mood && r.mood !== 'idle') moodTimer = setTimeout(() => { if (mood === r.mood) setMood('idle'); }, 4000);
    if (r.mood === 'happy' || r.mood === 'love') gesture('nod');
    else if (r.mood === 'sad') gesture('shake');
    if (r.confirm) $('yes').focus(); else q.focus();
    keepOpen();
    const spoken = await say(r.reply);
    // por voz: sigue escuchando unos segundos (o espera tu "sí"/"no") sin repetir "Panda"
    if (voiceTurn && (r.confirm || voiceInfo.followUp) && spoken !== false && !rec) startListening({ followUp: true });
    else if (!r.confirm) voiceTurn = false;
  }
  async function send(text, byVoice = false) {
    voiceTurn = byVoice;
    busy = true;
    lastTalkAt = performance.now();
    replyEl.textContent = '…';
    setMood('thinking');
    return showResult(await api.ask(text));
  }
  async function answer(yes) {
    confirmBox.hidden = true;
    awaitingConfirm = false;
    busy = true;
    replyEl.textContent = yes ? 'Trabajando en ello…' : '';
    if (yes) setMood('focused');
    return showResult(await api.confirm(yes));
  }

  $('ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    send(text);
  });
  for (const [id, yes] of [['yes', true], ['no', false]]) {
    $(id).addEventListener('click', () => { voiceTurn = false; answer(yes); });
  }
  $('chatClose').addEventListener('click', closeChat);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopSpeaking(); closeChat(); } });
  svg.addEventListener('dblclick', () => openChat());
  api.onOpenChat(() => openChat());

  // ---------- audio: utilidades ----------
  // cancelación de eco: no se oye a sí mismo por los parlantes
  const mic = () => ({
    audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      ...(voiceInfo.micId ? { deviceId: { exact: voiceInfo.micId } } : {}),
    },
  });
  // sensibilidad: umbral mínimo y cuántas veces sobre el ruido de fondo
  const SENS = { low: [0.03, 4], normal: [0.018, 3], high: [0.011, 2.2] };
  const rms = (d) => { let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); };

  // "tin" corto al oír su nombre
  function beep() {
    if (!voiceInfo.beep) return;
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => ctx.close();
  }

  // lista de micrófonos para el menú y Ajustes, y cuál está usando de verdad
  // (los nombres solo aparecen después de dar permiso)
  let activeMic = '';
  async function reportMics(track) {
    if (track) activeMic = track.label || activeMic;
    try {
      const list = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ id: d.deviceId, label: d.label }));
      api.reportMics({ list, active: activeMic, chosen: !!voiceInfo.micId && track?.getSettings().deviceId === voiceInfo.micId });
    } catch {}
  }
  // si conectas o desconectas un micrófono, se actualiza la lista
  navigator.mediaDevices.addEventListener('devicechange', () => reportMics());

  function encodeWav(chunks, rate) {
    const n = chunks.reduce((s, c) => s + c.length, 0);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
    return buf;
  }

  async function openMic(bufferSize, onChunk) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(mic()); } catch (err) {
      if (!voiceInfo.micId) throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { ...mic().audio, deviceId: undefined } });   // el elegido ya no está
    }
    reportMics(stream.getAudioTracks()[0]);
    const ctx = new AudioContext({ sampleRate: 16000 });   // whisper necesita 16 kHz
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(bufferSize, 1, 1);
    proc.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
    src.connect(proc);
    proc.connect(ctx.destination);
    return { close() { proc.disconnect(); stream.getTracks().forEach((tr) => tr.stop()); ctx.close(); } };
  }

  // ---------- escuchar una orden (🎤, Ctrl+Alt+V o después de "Panda") ----------
  // followUp: después de responder sigue escuchando unos segundos; si no hablas, se calla solo.
  async function startListening({ followUp = false } = {}) {
    if (rec) return stopListening();
    stopSpeaking();
    openChat(!followUp);
    if (!voiceInfo.stt) { replyEl.textContent = 'La voz aún no está instalada 🎙️'; return; }
    const [minLevel] = SENS[voiceInfo.sensitivity] || SENS.normal;
    try {
      const chunks = [];
      let heard = false, quiet = 0, total = 0;
      rec = { chunks, mic: null, followUp, heard: () => heard };
      rec.mic = await openMic(4096, (d, rate) => {
        if (!rec) return;
        chunks.push(d);
        const dt = d.length / rate;
        total += dt;
        if (rms(d) > minLevel + 0.002) { heard = true; quiet = 0; } else quiet += dt;
        // se detiene solo: 1.2 s de silencio después de hablar, 6 s (4 s si es seguimiento) sin oír nada o 10 s en total
        if ((heard && quiet > 1.2) || (!heard && total > (followUp ? 4 : 6)) || total > 10) stopListening();
      });
      micBtn.classList.add('on');
      dot();
      if (!followUp) replyEl.textContent = 'Te escucho… 🎙️';
      setMood('focused');
    } catch {
      rec = null;
      showResult({ reply: 'No pude usar el micrófono 😢 Revisa los permisos de Windows.', mood: 'sad' });
    }
  }

  const YES = /^(s[ií]|sip|claro|dale|ok|okay|hazlo|adelante|de una|por supuesto|confirmo|correcto|ya)\b/i;
  const NO = /^(no|nop|cancela|mejor no|olv[ií]dalo|para|detente)\b/i;

  async function stopListening() {
    if (!rec) return;
    const { mic, chunks, followUp, heard } = rec;
    rec = null;
    mic?.close();
    micBtn.classList.remove('on');
    dot();
    // seguimiento sin voz: se calla y vuelve a esperar "Panda"
    if (followUp && !heard()) {
      voiceTurn = false;
      if (awaitingConfirm) replyEl.textContent += ' (puedes usar los botones)';
      if (mood === 'focused') setMood('idle');
      return;
    }
    busy = true;
    replyEl.textContent = 'Entendiendo…';
    setMood('thinking');
    let text = '';
    try { text = await api.transcribe(encodeWav(chunks, 16000)); } catch {}
    text = text.replace(/^[¿¡\s]+/, '');
    if (!text) { busy = false; voiceTurn = false; return showResult({ reply: 'No te entendí bien 🙉 ¿Lo repites?', mood: 'sad' }); }
    // "sí" / "no" por voz cuando pidió confirmación
    if (awaitingConfirm) {
      if (YES.test(text)) return answer(true);
      if (NO.test(text)) return answer(false);
    }
    // "gracias", "eso es todo": termina la conversación
    if (followUp && /^(gracias|eso es todo|nada|nada m[aá]s|ya est[aá]|listo|ok gracias)\W*$/i.test(text)) {
      busy = false;
      voiceTurn = false;
      replyEl.textContent = '¡Cuando quieras! 🐼';
      setMood('happy');
      gesture('nod');
      keepOpen(4000);
      return say('¡Cuando quieras!');
    }
    send(text, true);
  }

  // ---------- hablar: frase por frase, con la boca siguiendo el sonido ----------
  let sayId = 0;
  function stopSpeaking() { sayId++; try { player?.stop(); } catch {} }

  // "Hola. Te aviso mañana." -> ["Hola. Te aviso mañana."]; frases cortas se juntan con la siguiente
  function sentences(text) {
    const raw = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["»)]*|[^.!?…]+$/g) || [text];
    const out = [];
    for (const s of raw.map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x))) {
      if (out.length && out[out.length - 1].length < 30) out[out.length - 1] += ' ' + s; else out.push(s);
    }
    return out.length ? out : [text];
  }

  // Forma de la boca según el sonido: más agudos = "a/e" abierta, más graves = "o/u" redonda, poco volumen = cerrada.
  function playWav(wav, id) {
    return new Promise(async (resolve) => {
      const ctx = new AudioContext();
      let audio;
      try { audio = await ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)); } catch { ctx.close(); return resolve(); }
      if (id !== sayId) { ctx.close(); return resolve(); }
      const src = ctx.createBufferSource();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.buffer = audio;
      src.connect(an);
      an.connect(ctx.destination);
      const wave = new Float32Array(an.fftSize), freq = new Uint8Array(an.frequencyBinCount);
      const hz = ctx.sampleRate / an.fftSize;
      const band = (a, b) => { let s = 0; for (let i = Math.floor(a / hz); i < b / hz; i++) s += freq[i]; return s; };
      let raf = 0;
      const tick = () => {
        an.getFloatTimeDomainData(wave);
        an.getByteFrequencyData(freq);
        talkLevel = rms(wave);
        talkShape = talkLevel < 0.035 ? 'small' : band(1800, 4000) > band(250, 900) * 0.45 ? 'open' : 'o';
        raf = requestAnimationFrame(tick);
      };
      player = src;
      src.onended = () => {
        cancelAnimationFrame(raf);
        ctx.close();
        if (player === src) player = null;
        resolve();
      };
      src.start();
      tick();
    });
  }

  // devuelve false si no habló (sin voz o la voz está apagada)
  async function say(text) {
    if (!voiceInfo.tts || !text) return false;
    stopSpeaking();
    const id = ++sayId;
    const parts = sentences(text);
    speaking = true;
    let spoke = false;
    // pide la primera frase; mientras suena, Kokoro ya prepara la siguiente
    let next = api.speak(parts[0]).catch(() => null);
    for (let i = 0; i < parts.length && id === sayId; i++) {
      const wav = await next;
      next = i + 1 < parts.length ? api.speak(parts[i + 1]).catch(() => null) : null;
      if (!wav || id !== sayId) continue;
      spoke = true;
      await playWav(wav, id);
    }
    talkLevel = null;
    talkShape = null;
    applyMouth(MOODS[mood].mouth);
    lastTalkAt = performance.now();
    // un respiro antes de volver a escuchar, para no oír el eco de su propia voz
    await new Promise((r) => setTimeout(r, 450));
    if (id === sayId) speaking = false;
    return spoke;
  }

  // ---------- palabra de activación: "Panda" ----------
  // Detecta cuándo alguien habla (por energía del sonido) y solo entonces le pregunta a whisper
  // si dijo "Panda". Mientras habla, atiende "Panda, para" (o solo "Panda") para callarse.
  let wake = null, checking = false;
  const STOP = /^(para|alto|basta|silencio|c[aá]llate|ya|stop|det[eé]nte|espera|suficiente)\b/i;

  async function startWake() {
    if (wake || !voiceInfo.stt || voiceInfo.micMuted) return;
    let pre = [], seg = null, quiet = 0, floor = 0.008;
    try {
      wake = await openMic(2048, (d, rate) => {
        const level = rms(d), dt = d.length / rate;
        if (rec || checking || busy) { seg = null; pre = []; return; }
        const [minLevel, times] = SENS[voiceInfo.sensitivity] || SENS.normal;
        // mientras habla, su propia voz sube el ruido: pide más volumen para cortarlo
        const threshold = Math.max(minLevel, floor * times) * (speaking ? 1.8 : 1);
        if (!seg) {
          if (level < threshold && !speaking) floor = floor * 0.97 + level * 0.03;   // ruido de fondo
          pre.push(d);
          if (pre.length > 3) pre.shift();                              // ~0.4 s antes de la voz
          if (level > threshold) { seg = { chunks: [...pre], dur: 0, voiced: 0, duringSpeech: speaking }; quiet = 0; }
          return;
        }
        seg.chunks.push(d);
        seg.dur += dt;
        if (level > threshold) { seg.voiced += dt; quiet = 0; } else quiet += dt;
        if (quiet > 0.7 || seg.dur > 7) {
          const s = seg;
          seg = null;
          pre = [];
          if (s.voiced > 0.25) checkWake(s.chunks, s.duringSpeech);
        }
      });
      dot();
    } catch { wake = null; }
  }
  function stopWake() { wake?.close(); wake = null; dot(); }

  async function checkWake(chunks, duringSpeech) {
    checking = true;
    try {
      const r = await api.wake(encodeWav(chunks, 16000));
      if (!r.wake) return;
      if (duringSpeech || speaking) {
        // "Panda, para" mientras habla: se calla. "Panda, abre…" mientras habla: se calla y lo hace.
        stopSpeaking();
        if (!r.command || STOP.test(r.command)) { replyEl.textContent = 'Ok, me callo 🤐'; setMood('idle'); voiceTurn = false; return; }
      }
      await onWake(r.command);
    } catch {} finally { checking = false; }
  }

  async function onWake(command) {
    stopSpeaking();
    clearTimeout(moodTimer);
    beep();
    gesture('hop');
    setMood('surprised');
    openChat();
    if (command && STOP.test(command)) { replyEl.textContent = 'Ok 🤐'; setMood('idle'); return; }
    if (command) return send(command, true);    // "Panda, abre la calculadora"
    replyEl.textContent = '¿Sí? 🐼';
    await say('¿Sí?');
    voiceTurn = true;
    startListening();                            // "Panda" … (pausa) … "abre la calculadora"
  }

  // ajustes que cambian desde el menú: micrófono, sensibilidad, silencio, palabra de activación…
  function applyConfig(c) {
    const micChanged = c.micId !== voiceInfo.micId;
    voiceInfo = { ...voiceInfo, ...c };
    micBtn.hidden = !c.stt;
    document.body.classList.toggle('birthday', !!c.birthday);
    const want = c.stt && c.wakeWord && !c.micMuted;
    if (!want || micChanged) stopWake();
    if (want) startWake();
    dot();
  }
  api.onConfig(applyConfig);
  api.onWalk(({ on, dir }) => window.setWalking?.(on, dir));
  api.onGesture((g) => gesture(g));

  micBtn.addEventListener('click', () => { voiceTurn = false; startListening(); });
  api.onListen(() => { voiceTurn = true; startListening(); });
  api.voiceStatus().then(applyConfig);
}
