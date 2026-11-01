// node --test   (pruebas de cómo entiende el tiempo en español latino)
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../tiempo');

const NOW = new Date(2026, 10, 1, 14, 0);   // domingo 1 nov 2026, 2:00 p. m.
const at = (text) => {
  const r = t.parseWhen(text, NOW);
  return r && `${r.date.getDate()} ${String(r.date.getHours()).padStart(2, '0')}:${String(r.date.getMinutes()).padStart(2, '0')}`;
};
const rest = (text) => t.parseWhen(text, NOW).rest;

test('mañana (el día) vs. en la mañana (la hora)', () => {
  assert.equal(at('recuérdame mañana en la tarde llamar a mi mamá'), '2 15:00');
  assert.equal(at('mañana en la mañana comprar pan'), '2 09:00');
  assert.equal(at('pasado mañana a las 7 de la mañana'), '3 07:00');
  assert.equal(at('a las 8 menos cuarto de la mañana'), '2 07:45');
});

test('horas sueltas y partes del día', () => {
  assert.equal(at('a las 5 la reunión'), '1 17:00');
  assert.equal(at('a las 10 de la noche'), '1 22:00');
  assert.equal(at('esta noche'), '1 20:00');
  assert.equal(at('a las 3 y media de la tarde'), '1 15:30');
  assert.equal(at('a las 9:15 pm'), '1 21:15');
  assert.equal(at('a la una de la tarde'), '2 13:00');
  assert.equal(at('mañana a las 3'), '2 15:00');
  assert.equal(at('el viernes al mediodía'), '6 12:00');
});

test('relativo', () => {
  assert.equal(at('en 10 minutos'), '1 14:10');
  assert.equal(at('en media hora'), '1 14:30');
  assert.equal(at('en una hora y media'), '1 15:30');
  assert.equal(at('al rato'), '1 15:00');
});

test('quita las palabras de tiempo y deja la tarea', () => {
  assert.equal(rest('mañana temprano ir al banco'), 'ir al banco');
  assert.equal(rest('recuérdame el viernes al mediodía almorzar con Ana'), 'recuérdame almorzar con Ana');
  assert.equal(t.parseWhen('tomar agua', NOW), null);
});

test('repeticiones', () => {
  assert.deepEqual(t.parseRepeat('todos los días a las 8 tomar la pastilla').repeat, { days: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(t.parseRepeat('cada lunes a las 9 reunión').repeat, { days: [1] });
  assert.deepEqual(t.parseRepeat('de lunes a viernes a las 7').repeat, { days: [1, 2, 3, 4, 5] });
  assert.deepEqual(t.parseRepeat('cada 30 minutos tomar agua').repeat, { every: 30 * 60e3 });
  assert.equal(t.spokenRepeat({ every: 3600e3 }), 'cada hora');
  // próxima vez: lunes 2 a las 9
  const next = t.nextRepeat({ days: [1] }, new Date(2026, 10, 1, 9, 0), NOW);
  assert.equal(next.getDate(), 2);
});

test('dice la hora como se habla', () => {
  assert.equal(t.spokenClock(new Date(2026, 0, 1, 15, 30)), 'las 3 y media de la tarde');
  assert.equal(t.spokenClock(new Date(2026, 0, 1, 13, 0)), 'la 1 de la tarde');
  assert.equal(t.spokenClock(new Date(2026, 0, 1, 12, 0)), 'las 12 del mediodía');
  assert.equal(t.spokenClock(new Date(2026, 0, 1, 7, 5)), 'las 7:05 de la mañana');
});
