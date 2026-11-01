// Entiende el tiempo como se dice en Latinoamérica y lo dice de vuelta en voz natural.
//   "mañana en la tarde", "pasado mañana a las 7 de la mañana", "en media hora", "al rato",
//   "el viernes al mediodía", "a las 3 y media", "esta noche", "en 10 minutos", "a las 15:00"…
// Ojo con "mañana": "mañana" = el día siguiente; "en/de/por la mañana" o "esta mañana" = antes del mediodía.

const WORDS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50,
};
const NUM = '(\\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veinticinco|treinta|cuarenta|cincuenta)';
const num = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[s]);
const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const PART = { madrugada: 4, manana: 9, mediodia: 12, tarde: 15, noche: 20 };

// minúsculas sin tildes y sin signos, con la MISMA longitud que el original (para recortar del texto real)
function fold(s) {
  return s.split('').map((c) => {
    const n = c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (n.length !== 1) return c.length === 1 ? ' ' : c;
    return /[a-z0-9:]/.test(n) ? n : ' ';
  }).join('');
}

/**
 * Busca cuándo en una frase. Devuelve { date, rest } o null si no menciona un momento.
 * `rest` es la frase original sin las palabras de tiempo (p. ej. "llamar a mi mamá").
 */
function parseWhen(text, now = new Date()) {
  const f = fold(text);
  const cut = [];
  const take = (re) => {
    const m = re.exec(f);
    if (m) cut.push([m.index, m.index + m[0].length]);
    return m;
  };
  let m;
  let rel = null, day = null, weekday = null, part = null, h = null, min = 0, ampm = null;

  // relativo: "en 10 minutos", "dentro de una hora y media", "en media hora", "al rato"
  if ((m = take(new RegExp(`\\b(?:en|dentro de)\\s+(?:${NUM}|media|un cuarto de)\\s*(horas?|minutos?|mins?|segundos?|hora)(\\s+y\\s+media)?\\b`)))) {
    const n = m[1] ? num(m[1]) : m[0].includes('media') ? 0.5 : 0.25;
    const unit = m[2].startsWith('h') ? 3600e3 : m[2].startsWith('s') ? 1e3 : 60e3;
    rel = (n + (m[3] ? 0.5 : 0)) * unit;
  } else if ((m = take(/\b(?:en|dentro de)\s+media\s+hora\b/))) rel = 30 * 60e3;
  else if ((m = take(/\b(?:al|en un)\s+ratito\b/))) rel = 15 * 60e3;
  else if ((m = take(/\b(?:al|en un)\s+rato\b|\bmas\s+tarde\b|\bluego\b/))) rel = 60 * 60e3;
  if (rel !== null) return { date: new Date(now.getTime() + rel), rest: remove(text, cut) };

  // día
  if (take(/\bpasado\s+manana\b/)) day = 2;
  else if (take(/(?<!\b(?:la|esta)\s)\bmanana\b/)) day = 1;
  else if (take(/\bhoy\b/)) day = 0;
  if ((m = take(/\b(?:el\s+)?(?:proximo\s+|este\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/))) weekday = DAYS.indexOf(m[1]);

  // parte del día
  if ((m = take(/\b(?:(?:en|por|de|a)\s+la|esta|en\s+esta)\s+(madrugada|manana|tarde|noche)\b/))) part = m[1];
  else if ((m = take(/\b(?:(?:a|al|en el|del)\s+)?(mediodia|medianoche)\b/))) { part = m[1] === 'mediodia' ? 'mediodia' : 'noche'; h = m[1] === 'mediodia' ? 12 : 24; }
  else if ((m = take(/\b(?:en la\s+)?(manana|tarde|noche)\s+temprano\b|\btemprano\b/))) part = 'manana';

  // hora: "a las 3", "a la una y media", "a las 15:30", "7 pm", "a las 5 menos cuarto", "a las 8 en punto"
  if ((m = take(new RegExp(`\\b(?:a\\s+las?|las?|para\\s+las?)\\s+${NUM}(?::(\\d{2})|\\s+y\\s+(media|cuarto|${NUM})|\\s+(menos\\s+cuarto)|\\s+en\\s+punto)?(?:\\s+(am|pm|a\\s?m|p\\s?m))?\\b`)))
    || (m = take(new RegExp(`\\b${NUM}(?::(\\d{2}))?()()()\\s*(am|pm|a\\s?m|p\\s?m)\\b`)))) {
    h = num(m[1]);
    if (m[2]) min = Number(m[2]);
    else if (m[3] === 'media') min = 30;
    else if (m[3] === 'cuarto') min = 15;
    else if (m[3]) min = num(m[4] || m[3]) || 0;
    if (m[5]) { h -= 1; min = 45; }
    if (m[6]) ampm = m[6].replace(/\s/g, '')[0];
  }

  if (day === null && weekday === null && part === null && h === null) return null;

  // ajusta la hora según la parte del día
  if (h === null) h = part ? PART[part] : 9;
  else if (ampm === 'p' || ((part === 'tarde' || part === 'noche') && h < 12)) h += 12;
  else if (ampm === 'a' && h === 12) h = 0;
  else if (part === 'noche' && h === 12) h = 24;
  else if (!part && !ampm && h >= 1 && h <= 7) h += 12;   // "a las 3" = 15:00 (de madrugada hay que decirlo)

  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (weekday !== null) {
    let add = (weekday - now.getDay() + 7) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
  } else if (day) d.setDate(d.getDate() + day);
  d.setHours(h, min, 0, 0);

  // sin día dicho y la hora ya pasó: "a las 5" a las 14:00 son las 17:00; si no, mañana
  if (day === null && weekday === null && d <= now) {
    if (!part && !ampm && h < 12 && new Date(d.getTime() + 12 * 3600e3) > now) d.setHours(h + 12);
    else d.setDate(d.getDate() + 1);
  }
  return { date: d, rest: remove(text, cut) };
}

function remove(text, spans) {
  const keep = text.split('');
  for (const [a, b] of spans) for (let i = a; i < b; i++) keep[i] = ' ';   // los tramos pueden solaparse
  return keep.join('').replace(/\s+/g, ' ').trim();
}

// "las 3 de la tarde", "la 1 y media de la tarde", "las 12 del mediodía", "las 8:05 de la noche"
function spokenClock(date) {
  const h24 = date.getHours(), mm = date.getMinutes();
  const h = h24 % 12 || 12;
  const minutes = mm === 0 ? '' : mm === 30 ? ' y media' : mm === 15 ? ' y cuarto' : `:${String(mm).padStart(2, '0')}`;
  const part = h24 === 12 && mm === 0 ? 'del mediodía' : h24 < 6 ? 'de la madrugada' : h24 < 12 ? 'de la mañana' : h24 < 20 ? 'de la tarde' : 'de la noche';
  return `${h === 1 ? 'la' : 'las'} ${h}${minutes} ${part}`;
}

// "hoy", "mañana", "pasado mañana", "el viernes 7"
function spokenDay(date, now = new Date()) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(date); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 86400e3);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === 2) return 'pasado mañana';
  const name = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][date.getDay()];
  return diff < 7 ? `el ${name}` : `el ${name} ${date.getDate()}`;
}

// "en 10 minutos", "hoy a las 3 de la tarde", "mañana a la 1 de la tarde"
function spokenWhen(date, now = new Date()) {
  const mins = Math.round((date - now) / 60e3);
  if (mins < 60) return mins <= 1 ? 'en un minuto' : `en ${mins} minutos`;
  return `${spokenDay(date, now)} a ${spokenClock(date)}`;
}

/**
 * Repeticiones: "todos los días", "cada lunes", "de lunes a viernes", "cada hora", "cada 30 minutos".
 * Devuelve { repeat, text } (repeat = { every: ms } | { days: [0..6] }) o null; `text` queda sin esas palabras.
 */
function parseRepeat(text) {
  const f = fold(text);
  let m, repeat = null;
  if ((m = new RegExp(`\\bcada\\s+(?:${NUM}\\s+)?(horas?|minutos?)\\b`).exec(f))) {
    const n = m[1] ? num(m[1]) : 1;
    repeat = { every: n * (m[2].startsWith('h') ? 3600e3 : 60e3) };
  } else if ((m = /\b(?:todos los dias|todas las (?:mananas|tardes|noches)|cada dia|diario|diariamente)\b/.exec(f))) {
    repeat = { days: [0, 1, 2, 3, 4, 5, 6] };
  } else if ((m = /\bde lunes a viernes\b|\bentre semana\b|\bdias de semana\b/.exec(f))) {
    repeat = { days: [1, 2, 3, 4, 5] };
  } else if ((m = /\b(?:los fines de semana|cada fin de semana)\b/.exec(f))) {
    repeat = { days: [0, 6] };
  } else if ((m = /\b(?:cada|todos los)\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b/.exec(f))) {
    repeat = { days: [DAYS.indexOf(m[1])] };
  }
  if (!repeat) return null;
  // "todas las tardes" también dice la parte del día
  const part = /\btodas las (mananas|tardes|noches)\b/.exec(f);
  const rest = remove(text, [[m.index, m.index + m[0].length]]);
  return { repeat, text: part ? `${rest} en la ${part[1].slice(0, -1).replace('manana', 'mañana')}` : rest };
}

// Próxima vez que toca un recordatorio que se repite, después de `after`.
function nextRepeat(repeat, at, after = new Date()) {
  if (repeat.every) {
    let t = at.getTime();
    while (t <= after.getTime()) t += repeat.every;
    return new Date(t);
  }
  const d = new Date(at);
  for (let i = 0; i < 400 && (d <= after || !repeat.days.includes(d.getDay())); i++) d.setDate(d.getDate() + 1);
  return d;
}

function spokenRepeat(repeat) {
  if (repeat.every) {
    const min = Math.round(repeat.every / 60e3);
    return min % 60 === 0 ? (min === 60 ? 'cada hora' : `cada ${min / 60} horas`) : `cada ${min} minutos`;
  }
  const d = repeat.days;
  if (d.length === 7) return 'todos los días';
  if (d.join() === '1,2,3,4,5') return 'de lunes a viernes';
  if (d.join() === '0,6') return 'los fines de semana';
  return `todos los ${['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][d[0]]}`;
}

module.exports = { parseWhen, parseRepeat, nextRepeat, spokenRepeat, spokenClock, spokenDay, spokenWhen, _fold: fold };
