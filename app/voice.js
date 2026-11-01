// Voz sin internet, todo open source:
//   escuchar: whisper.cpp (MIT). Dos servidores locales:
//     - "oído": modelo base, liviano, siempre listo para detectar la palabra "Panda"
//     - "atento": el mejor modelo instalado (large-v3-turbo) para entender la orden;
//       se descarga de memoria tras 10 min sin uso
//     Con tarjeta NVIDIA (whisper-cuda instalado) un solo servidor en GPU con large-v3-turbo hace
//     las dos cosas: tarda ~0.1 s por frase, así que siempre escucha con el modelo más preciso.
//     Si la GPU falla, vuelve solo a la CPU.
//   hablar: Kokoro-82M (Apache 2.0) con pronunciación latinoamericana (es-419) y Piper (MIT) como respaldo
// Los componentes se instalan con setup-voice.ps1 en %USERPROFILE%\.micropanda\voice
// (ruta corta: algunas librerías de Python fallan en rutas de más de 260 caracteres).
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = process.env.MICROPANDA_VOICE_DIR || path.join(os.homedir(), '.micropanda', 'voice');
const IDLE_UNLOAD_MS = 10 * 60 * 1000;

const fileCache = new Map();
function find(test, key) {
  if (key && fileCache.has(key) && (fileCache.get(key) === null || fs.existsSync(fileCache.get(key)))) return fileCache.get(key);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'py') { const r = walk(p); if (r) return r; } } else if (test(e.name)) return p;
    }
    return null;
  };
  const found = walk(DIR);
  if (key && found) fileCache.set(key, found);
  return found;
}

let precise = true;   // true: el modelo más grande instalado; false: el más liviano
let device = 'auto';  // 'auto' | 'gpu' | 'cpu'
let gpuBroken = false;
let gpuName = null;
const HAS_NVIDIA = fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'));
const whisperExe = (sub, name) => {
  const p = path.join(DIR, sub, 'Release', name);
  return fs.existsSync(p) ? p : null;
};

function paths() {
  const large = find((n) => /^ggml-large.*\.bin$/.test(n), 'large');
  const small = find((n) => n === 'ggml-small.bin', 'small');
  const base = find((n) => n === 'ggml-base.bin', 'base');
  const kokoroModel = find((n) => n === 'kokoro-v1.0.onnx', 'kokoro');
  const py = path.join(DIR, 'py', 'Scripts', 'python.exe');
  return {
    whisper: whisperExe('whisper', 'whisper-cli.exe') || find((n) => n === 'whisper-cli.exe', 'cli') || find((n) => n === 'main.exe', 'main'),
    whisperServer: whisperExe('whisper', 'whisper-server.exe') || find((n) => n === 'whisper-server.exe', 'server'),
    whisperServerGpu: HAS_NVIDIA ? whisperExe('whisper-cuda', 'whisper-server.exe') : null,
    bestModel: large || small || base,
    sttModel: (precise ? large || small || base : base || small || large),
    wakeModel: base || small || large,
    hasChoice: !!(large || small) && !!base,
    piper: find((n) => n === 'piper.exe', 'piper'),
    piperVoice: find((n) => n.endsWith('.onnx') && !n.startsWith('kokoro'), 'piperVoice'),
    kokoro: kokoroModel && find((n) => n === 'voices-v1.0.bin', 'voices') && fs.existsSync(py) ? { py, models: path.dirname(kokoroModel) } : null,
  };
}

// ¿Se usa la GPU? 'auto' la usa si hay NVIDIA con whisper-cuda instalado y no falló antes.
const gpuOn = () => device !== 'cpu' && !gpuBroken && !!paths().whisperServerGpu;

function status() {
  const p = paths();
  const gpu = gpuOn();
  return {
    stt: !!(p.whisper && p.sttModel),
    tts: !!(p.kokoro || (p.piper && p.piperVoice)),
    sttModel: p.sttModel ? path.basename(gpu ? p.bestModel : p.sttModel) : null,
    precise, canChoosePrecision: p.hasChoice && !gpu,   // en GPU siempre usa el modelo preciso
    ttsEngine: p.kokoro ? 'Kokoro-82M' : p.piper ? 'Piper' : null,
    device, gpu, gpuAvailable: !!p.whisperServerGpu && !gpuBroken, gpuName,
    ttsDevice: kk && kk.device ? kk.device : 'cpu',
  };
}

const tmp = (name) => path.join(os.tmpdir(), `micropanda-${process.pid}-${name}`);
const CPUS = os.cpus().length;
// Ventana de audio de ~10 s (la grabación se corta a los 10 s): mucho más rápido que los 30 s por defecto.
// En GPU sobra velocidad: búsqueda con 5 haces (beam search) para entender mejor.
const whisperArgs = (threads, gpu) => ['-l', 'es', '-t', String(threads), '-ac', '512', ...(gpu ? ['-bs', '5', '-bo', '5'] : ['-bs', '1', '-bo', '1'])];
// quita [Música], (risas)… y arregla la eñe cuando el modelo la pierde ("manana" -> "mañana")
const cleanText = (s) => s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b([Mm])anana(s?)\b/g, '$1añana$2')
  .replace(/\s+/g, ' ').trim();

// ---------- servidores de whisper con el modelo cargado ----------
// pick(p) -> { model, gpu }: qué modelo cargar y si va en la GPU.
function whisperServer(port, pick, threads, unloadAfter) {
  let s = null, idleTimer = 0;
  const stop = () => { clearTimeout(idleTimer); if (s) { s.proc.kill(); s = null; } };
  function start() {
    const p = paths();
    const { model, gpu } = pick(p);
    const exe = gpu ? p.whisperServerGpu : p.whisperServer;
    if (s && s.model === model && s.gpu === gpu) return s.ready;
    stop();
    if (!exe || !model) return Promise.reject(new Error('whisper-server no disponible'));
    const proc = spawn(exe, ['-m', model, ...whisperArgs(gpu ? 4 : threads, gpu), '--host', '127.0.0.1', '--port', String(port)],
      { windowsHide: true, stdio: 'ignore', cwd: path.dirname(exe) });   // cwd: las DLL de CUDA están junto al .exe
    let ready = (async () => {
      for (let i = 0; i < 120; i++) {
        if (proc.exitCode !== null) throw new Error('whisper-server se cerró');
        try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); return true; } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('whisper-server no respondió');
    })();
    // si la GPU no arranca (driver viejo, sin memoria…), se marca y se sigue con la CPU
    if (gpu) {
      ready = ready.catch((err) => {
        console.warn('GPU no disponible, uso la CPU:', err.message);
        gpuBroken = true;
        proc.kill();
        s = null;
        return start();
      });
    }
    ready.catch(() => {});
    proc.on('exit', () => { if (s && s.proc === proc) s = null; });
    s = { proc, ready, model, gpu };
    return ready;
  }
  async function transcribe(wav, prompt) {
    await start();
    clearTimeout(idleTimer);
    const ms = typeof unloadAfter === 'function' ? unloadAfter() : unloadAfter;
    if (ms) idleTimer = setTimeout(stop, ms);
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(wav)], { type: 'audio/wav' }), 'in.wav');
    fd.append('response_format', 'text');
    if (prompt) fd.append('prompt', prompt);   // pista de vocabulario para whisper
    const r = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`whisper-server respondió ${r.status}`);
    return cleanText(await r.text());
  }
  return { start, stop, transcribe, get running() { return !!s; } };
}

let wakeEnabled = false;
// CPU: "atento" (modelo preciso, se libera tras 10 min) y "oído" (base, liviano).
// GPU: el "oído" carga large-v3-turbo en la GPU y atiende todo.
const main = whisperServer(8178, (p) => ({ model: p.sttModel, gpu: false }), Math.max(2, Math.min(8, CPUS - 2)), IDLE_UNLOAD_MS);
const ear = whisperServer(8179, (p) => (gpuOn() ? { model: p.bestModel, gpu: true } : { model: p.wakeModel, gpu: false }),
  Math.max(2, Math.min(4, CPUS / 3)), () => (wakeEnabled ? 0 : IDLE_UNLOAD_MS));
const listener = () => (gpuOn() ? ear : main);

// Pista de vocabulario: español latino y frases típicas, para que entienda "mañana", "tarde", "bájale"…
const STT_PROMPT = 'Panda, recuérdame mañana en la tarde llamar a mi mamá. Bájale al volumen, porfa. ¿Qué hora es?';

// respaldo: un proceso por pedido (más lento porque carga el modelo cada vez)
function transcribeCli(wav) {
  const p = paths();
  if (!p.whisper || !p.sttModel) return Promise.reject(new Error('Falta instalar la voz (setup-voice.ps1)'));
  const file = tmp('in.wav');
  fs.writeFileSync(file, Buffer.from(wav));
  return new Promise((resolve, reject) => {
    execFile(p.whisper, ['-m', p.sttModel, '-f', file, '-nt', '-np', ...whisperArgs(Math.max(2, CPUS - 2))], { windowsHide: true, timeout: 90000 },
      (err, stdout) => {
        fs.rm(file, { force: true }, () => {});
        if (err) return reject(err);
        resolve(cleanText(stdout));
      });
  });
}

async function transcribe(wav) {
  try { return await listener().transcribe(wav, STT_PROMPT); } catch { return transcribeCli(wav); }
}

// ---------- palabra de activación "Panda" ----------
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
// Solo al inicio de la frase (o tras un saludo): "panda", "oye panda", "hola micropanda, abre…".
// Acepta variantes con las que whisper suele confundir la palabra suelta ("pander", "pande", "paanda"…)
// y "oye" mal oído como "hoy".
const GREET = '(?:(?:oye|hoy|oi|oiga|hey|ey|epa|hola|ok|okay|eh|ah|ya)\\s+)?';
const PANDA = '(?:micro\\s?)?(?:p+a+n+d(?:a+s?|ita|era|er|e)?|pan da)';
let wakeName = 'panda';
let WAKE = new RegExp(`^${GREET}${PANDA}\\b\\s*(.*)$`);
let WAKE_PROMPT = 'Panda.';

// Nombre propio ("Bambú", "Osito"…): se acepta además de "Panda".
function setWakeName(name) {
  wakeName = normalize(name || 'panda').replace(/[^a-zñ]/g, '') || 'panda';
  const own = wakeName === 'panda' ? '' : `|${wakeName.replace(/(.)\1*/g, (s, c) => `${c}+`)}`;
  WAKE = new RegExp(`^${GREET}(?:${PANDA}${own})\\b\\s*(.*)$`);
  WAKE_PROMPT = wakeName === 'panda' ? 'Panda.' : `${wakeName[0].toUpperCase()}${wakeName.slice(1)}. Panda.`;
}

function matchWake(text) {
  const m = normalize(text).match(WAKE);
  if (!m) return { wake: false, command: '' };
  // si el modelo repitió la frase ("abre x panda abre x"), se queda con la primera vez
  const command = m[1].split(new RegExp(`\\b(?:panda|${wakeName})\\b`))[0].trim();
  return { wake: true, command };
}

// Revisa un fragmento de voz: ¿dijeron "Panda"? Si además dieron una orden, la devuelve.
// `isClear(orden)` indica si la orden ya se entiende; si no, se vuelve a escuchar con el modelo preciso.
async function wake(wav, isClear = () => false) {
  const heard = await ear.transcribe(wav, WAKE_PROMPT);
  const hit = matchWake(heard);
  // en GPU el "oído" ya es el modelo preciso: no hace falta volver a escuchar
  if (!hit.wake || !hit.command || gpuOn() || isClear(hit.command) || !precise || !status().canChoosePrecision) return { ...hit, heard };
  try {
    const better = matchWake(await main.transcribe(wav, WAKE_PROMPT));
    if (better.wake && better.command && better.command.length < hit.command.length * 1.8) return { ...better, heard };
  } catch {}
  return { ...hit, heard };
}

function setWakeEnabled(on) { wakeEnabled = !!on; if (on) ear.start().catch(() => {}); else ear.stop(); }

// ---------- hablar: Kokoro (servidor que se queda abierto) ----------
let kk = null;
let kokoroVoice = process.env.MICROPANDA_VOICE || 'ef_dora';
let voiceSpeed = 1;   // 0.8 = más lenta, 1.2 = más rápida

function startKokoro() {
  if (kk) return kk.ready;
  const p = paths().kokoro;
  if (!p) return Promise.reject(new Error('Kokoro no está instalado'));
  // empaquetado, el script queda fuera del .asar (Python no puede leer adentro)
  const script = path.join(__dirname, 'kokoro_tts.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const proc = spawn(p.py, [script, p.models], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MICROPANDA_DEVICE: device, MICROPANDA_LANG: 'es-419' },
  });
  const pending = new Map();
  let buf = '', errText = '', onReady, onFail;
  const ready = new Promise((resolve, reject) => { onReady = resolve; onFail = reject; });
  ready.catch(() => {});
  const self = { proc, ready, pending, n: 0, device: null };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { self.device = msg.device; onReady(msg); }
      else if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  proc.stderr.on('data', (d) => { errText = (errText + d).slice(-800); });
  proc.on('exit', () => {
    onFail(new Error('Kokoro se cerró: ' + errText.trim().split('\n').pop()));
    for (const cb of pending.values()) cb({ ok: false, error: 'Kokoro se cerró' });
    if (kk === self) kk = null;   // al cambiar de GPU a CPU ya puede haber otro proceso nuevo
  });
  kk = self;
  return ready;
}

async function speakKokoro(text) {
  await startKokoro();
  const id = ++kk.n;
  const out = tmp(`k-${id}.wav`);
  const res = await new Promise((resolve) => {
    kk.pending.set(id, resolve);
    kk.proc.stdin.write(JSON.stringify({ id, text, out, voice: kokoroVoice, speed: voiceSpeed }) + '\n');
  });
  if (!res.ok) throw new Error(res.error);
  const data = fs.readFileSync(out);
  fs.rm(out, { force: true }, () => {});
  return data;
}

// ---------- hablar: Piper (respaldo) ----------
function speakPiper(text) {
  const p = paths();
  if (!p.piper || !p.piperVoice) return Promise.reject(new Error('Falta instalar la voz (setup-voice.ps1)'));
  const out = tmp(`p-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const child = spawn(p.piper, ['--model', p.piperVoice, '--output_file', out], { windowsHide: true, cwd: path.dirname(p.piper) });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(out)) return reject(new Error(`Piper terminó con código ${code}`));
      const data = fs.readFileSync(out);
      fs.rm(out, { force: true }, () => {});
      resolve(data);
    });
    child.stdin.end(text);
  });
}

async function speak(text) {
  const clean = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (paths().kokoro) {
    try { return await speakKokoro(clean); } catch (err) { console.warn('Kokoro falló, uso Piper:', err.message); }
  }
  return speakPiper(clean);
}

function setPrecise(value) { precise = !!value; if (main.running) main.start().catch(() => {}); }
function setVoice(id) { kokoroVoice = id; }
function setSpeed(v) { voiceSpeed = Math.max(0.7, Math.min(1.4, Number(v) || 1)); }

// Cambia entre GPU y CPU en caliente: reinicia los servidores que estén cargados.
function setDevice(value) {
  device = ['gpu', 'cpu'].includes(value) ? value : 'auto';
  gpuBroken = false;
  main.stop();
  if (ear.running) { ear.stop(); if (wakeEnabled) ear.start().catch(() => {}); }
  if (kk) { kk.proc.kill(); kk = null; startKokoro().catch(() => {}); }
}

// nombre de la tarjeta para mostrarlo en el menú
function detectGpu() {
  if (!HAS_NVIDIA) return;
  execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true, timeout: 5000 },
    (err, out) => { if (!err) gpuName = out.split('\n')[0].trim() || null; });
}

// Deja Kokoro listo desde el inicio; whisper "atento" se carga recién al primer uso.
function warmup({ wakeWord }) {
  detectGpu();
  wakeEnabled = !!wakeWord;
  if (wakeWord) ear.start().catch(() => {});
  if (paths().kokoro) startKokoro().catch(() => {});
}
function stop() { main.stop(); ear.stop(); if (kk) kk.proc.kill(); }

module.exports = {
  status, transcribe, wake, speak, warmup, stop, setPrecise, setVoice, setSpeed, setDevice, setWakeEnabled, setWakeName,
  _matchWake: matchWake, _cleanText: cleanText,
};
