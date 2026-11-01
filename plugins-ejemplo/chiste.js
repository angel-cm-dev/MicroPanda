// Plugin de ejemplo para MicroPanda.
// Cópialo a %USERPROFILE%\.micropanda\plugins\ y reinicia la app.
// Cada plugin exporta una lista de acciones: { id, patterns, run, confirm?, llm? }.
//   patterns: expresiones regulares sobre la frase en minúsculas y sin tildes
//   run(m, text): devuelve { reply, mood } (mood: happy, love, surprised, thinking, focused, annoyed, sad, sleepy, idle)
//   llm: descripción para que Ollama también pueda elegirla con frases libres
// Si recibe una función, se la llama con { ps, launch, electron, brain, llm, tiempo }.
const CHISTES = [
  '¿Qué le dice un panda a otro? ¡Nada, los pandas no hablan! Bueno… yo sí 🐼',
  '¿Por qué la computadora fue al doctor? Porque tenía un virus 🤒',
  '¿Cuál es el café más peligroso del mundo? El ex-preso ☕',
];

module.exports = [
  {
    id: 'chiste',
    pc: false,               // no toca la PC: funciona también en "modo solo charla"
    llm: 'contar un chiste',
    patterns: [/\b(cuentame un chiste|un chiste|hazme reir)\b/],
    run: async () => ({ reply: CHISTES[Math.floor(Math.random() * CHISTES.length)], mood: 'happy' }),
  },
];
