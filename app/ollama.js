// Entendimiento de lenguaje natural con Ollama (local, sin internet).
// El modelo NO ejecuta nada: solo elige una acción de la lista cerrada o responde una charla corta.
// Recuerda las últimas frases de la conversación ("ábrelo otra vez", "¿y mañana?") y lo que le contaste de ti.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const PREFERRED = ['qwen2.5:7b', 'qwen2.5:3b', 'llama3.2:3b', 'qwen2.5-coder:7b-instruct', 'qwen2.5-coder:7b'];
let model = process.env.MICROPANDA_MODEL || null;
let chosen = '';            // modelo elegido en el menú ('' = automático)
const history = [];         // últimos turnos de la conversación (solo en memoria)
const HISTORY_TURNS = 6;

async function get(url, ms = 1500) {
  const r = await fetch(HOST + url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  return r.json();
}

async function listModels() {
  try { return ((await get('/api/tags')).models || []).map((m) => m.name); } catch { return []; }
}

async function pickModel() {
  if (model) return model;
  const names = await listModels();
  model = (chosen && names.includes(chosen) && chosen) || PREFERRED.find((p) => names.includes(p)) || names[0] || null;
  return model;
}

function setModel(name) { chosen = name || ''; model = process.env.MICROPANDA_MODEL || null; pickModel().then(warm).catch(() => {}); }
const warm = () => model && fetch(HOST + '/api/generate', { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '15m' }) }).catch(() => {});

// Si Ollama está instalado pero apagado, lo enciende y deja el modelo cargado en memoria.
async function start() {
  try { await get('/api/tags'); } catch {
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    if (!fs.existsSync(exe)) return false;
    spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { await get('/api/tags'); break; } catch {}
    }
  }
  try {
    if (!(await pickModel())) return false;
    warm();
    return true;
  } catch { return false; }
}

// Descarga un modelo nuevo (ollama pull). onProgress(texto) para mostrar el avance.
async function pull(name, onProgress = () => {}) {
  const r = await fetch(HOST + '/api/pull', { method: 'POST', body: JSON.stringify({ model: name }) });
  if (!r.ok || !r.body) throw new Error(`No pude descargar ${name}`);
  const dec = new TextDecoder();
  let buf = '', lastPct = -1;
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const msg = JSON.parse(buf.slice(0, i) || '{}');
      buf = buf.slice(i + 1);
      if (msg.error) throw new Error(msg.error);
      const pct = msg.total ? Math.floor((100 * msg.completed) / msg.total) : -1;
      if (pct >= 0 && pct !== lastPct && pct % 10 === 0) { lastPct = pct; onProgress(`${pct}%`); }
    }
  }
}

// Acciones que el modelo puede elegir. commands.js agrega las suyas con addActions().
const ACTIONS = {
  chat: 'conversación: saludos, chistes, preguntas generales que respondes con texto',
  unknown: 'piden una acción en la PC que no está en esta lista',
};
function addActions(obj) { Object.assign(ACTIONS, obj); }

const MOODS = {
  happy: 'alegre, celebra o saluda',
  love: 'le dicen algo cariñoso o lo elogian',
  surprised: 'algo inesperado o asombroso',
  thinking: 'pregunta difícil o curiosa',
  focused: 'tarea técnica o seria',
  annoyed: 'lo tratan mal o piden algo absurdo',
  sad: 'el usuario está triste o algo salió mal',
  sleepy: 'hablan de dormir o cansancio',
  idle: 'neutral',
};

const PERSONALITIES = {
  tierno: 'amable, tierno y cariñoso',
  gracioso: 'bromista y divertido: haces chistes cortos y juegos de palabras',
  profesional: 'profesional, claro y directo, sin bromas ni diminutivos',
  serio: 'serio y muy breve: respondes con lo justo',
};

function systemPrompt({ appNames = [], userName, facts = [], personality = 'tierno' }) {
  return [
    `Eres MicroPanda, un panda asistente de escritorio para Windows. Tu personalidad: ${PERSONALITIES[personality] || PERSONALITIES.tierno}.`,
    'Respondes SIEMPRE en español latinoamericano neutro: tuteas, dices "computadora", "celular", "ahorita"; nunca usas "vosotros" ni "ordenador".',
    'Entiendes modismos latinos: "bájale/súbele" (volumen), "prende" (abrir/encender), "porfa", "al rato", "mañana en la tarde".',
    userName ? `El usuario se llama ${userName}.` : '',
    facts.length ? `Lo que sabes del usuario (úsalo si viene al caso):\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
    `Hoy es ${new Date().toLocaleString('es-419', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}.`,
    'Clasifica el mensaje del usuario en UNA de estas acciones (campo "intent"):',
    ...Object.entries(ACTIONS).map(([id, d]) => `- ${id}: ${d}`),
    `Para "open", "target" debe ser uno de estos nombres: ${appNames.join(', ')}, una app instalada o una página web. Si no existe, usa "unknown".`,
    'Para el resto de acciones con datos (ciudad, tarea, nota, app a cerrar…), pon ese dato en "target".',
    'Usa la conversación anterior para entender "eso", "otra vez", "y mañana?".',
    'En "reply" escribe una respuesta corta (máximo 2 oraciones, como mucho 1 emoji).',
    'Para acciones de la PC, "reply" solo anuncia lo que harás. Nunca inventes acciones ni comandos.',
    'En "mood" elige la emoción que MicroPanda debe mostrar al responder:',
    ...Object.entries(MOODS).map(([id, d]) => `- ${id}: ${d}`),
  ].filter(Boolean).join('\n');
}

function remember(user, assistant) {
  history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
  while (history.length > HISTORY_TURNS * 2) history.shift();
}

// ---------- modelo en la nube (opcional, apagado por defecto) ----------
// cloud = { provider: 'anthropic' | 'openai', url, model, key } — openai sirve para cualquier API compatible
// (OpenRouter, Groq, LM Studio…). Si falla, se usa Ollama.
let cloud = null;
function setCloud(c) { cloud = c && c.provider && c.provider !== 'off' && c.key ? c : null; }

async function cloudChat(system, messages, { json = false, maxTokens = 500 } = {}) {
  if (cloud.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cloud.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cloud.model || 'claude-haiku-5-5', max_tokens: maxTokens,
        system: json ? `${system}\nResponde SOLO con un objeto JSON válido, sin texto extra.` : system, messages,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`La nube respondió ${r.status}`);
    return (await r.json()).content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  const r = await fetch(`${(cloud.url || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cloud.key}` },
    body: JSON.stringify({
      model: cloud.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`La nube respondió ${r.status}`);
  return (await r.json()).choices[0].message.content.trim();
}

// ¿Hay un modelo de visión en Ollama? (para "explícame este error de la pantalla")
async function visionModel() {
  const names = await listModels();
  return names.find((n) => /llava|vision|-vl|vl:|moondream|minicpm-v|gemma3|bakllava/i.test(n)) || null;
}

const parseOut = (out) => ({
  intent: ACTIONS[out.intent] ? String(out.intent) : 'unknown', target: String(out.target || ''),
  reply: String(out.reply || '').slice(0, 280), mood: MOODS[out.mood] ? out.mood : 'happy',
});

async function interpret(text, ctx = {}) {
  if (cloud) {
    try {
      const sys = `${systemPrompt(ctx)}\nDevuelve JSON con las claves "intent", "target", "reply" y "mood".`;
      const raw = await cloudChat(sys, [...history, { role: 'user', content: text }], { json: true, maxTokens: 300 });
      return parseOut(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
    } catch (err) { console.warn('Nube no disponible, uso Ollama:', err.message); }
  }
  if (!(await pickModel())) throw new Error('No hay modelos en Ollama');
  const body = {
    model,
    stream: false,
    keep_alive: '15m',
    options: { temperature: 0.1 },
    format: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: Object.keys(ACTIONS) },
        target: { type: 'string' },
        reply: { type: 'string' },
        mood: { type: 'string', enum: Object.keys(MOODS) },
      },
      required: ['intent', 'reply', 'mood'],
    },
    messages: [{ role: 'system', content: systemPrompt(ctx) }, ...history, { role: 'user', content: text }],
  };
  const r = await fetch(HOST + '/api/chat', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  return parseOut(JSON.parse((await r.json()).message.content));
}

// Texto libre (resumir, traducir, explicar lo que copiaste o la pantalla). Respuesta corta, sin acciones.
// ctx.images = [png en base64] con ctx.model = un modelo de visión de Ollama.
async function generate(instruction, content, ctx = {}) {
  const system = `Eres MicroPanda. Personalidad: ${PERSONALITIES[ctx.personality] || PERSONALITIES.tierno}. Español latinoamericano. Respuestas cortas (máximo 5 oraciones), sin markdown.`;
  const user = `${instruction}\n\n"""\n${content.slice(0, 6000)}\n"""`;
  if (cloud && !ctx.images) {
    try { return await cloudChat(system, [{ role: 'user', content: user }]); } catch (err) { console.warn('Nube no disponible, uso Ollama:', err.message); }
  }
  if (!ctx.model && !(await pickModel())) throw new Error('No hay modelos en Ollama');
  const body = {
    model: ctx.model || model,
    stream: false,
    keep_alive: '15m',
    options: { temperature: 0.3, num_predict: 400 },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user, ...(ctx.images ? { images: ctx.images } : {}) },
    ],
  };
  const r = await fetch(HOST + '/api/chat', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  return (await r.json()).message.content.trim();
}

module.exports = {
  start, interpret, generate, remember, addActions, listModels, setModel, pull, visionModel, setCloud, PERSONALITIES,
  get model() { return model; },
  get cloudOn() { return !!cloud; },
};
