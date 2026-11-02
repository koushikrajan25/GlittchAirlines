function startScheduler({ fly, voiceStay, typing }) {
  const every = (name, ms, fn) => setInterval(() => {
    Promise.resolve().then(fn).catch((err) => console.error(`${name} error:`, err.message));
  }, ms);
  const timers = [
    every('Fly', 500, () => fly.processDue()),                
    every('24/7 voice', 20_000, () => voiceStay.ensure()),  
    every('Typing', 8_000, () => typing.tick()),             
  ];
  return () => timers.forEach(clearInterval);
}
module.exports = { startScheduler };
