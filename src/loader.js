const fs = require('fs');
const path = require('path');

function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  const map = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const cmd = require(path.join(dir, file));
    map.set(cmd.data.name, cmd);
  }
  return map;
}
module.exports = { loadCommands };
