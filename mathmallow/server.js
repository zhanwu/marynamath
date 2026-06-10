'use strict';

const os = require('os');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';

const { app, dirs } = createApp();

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push(iface.address);
      }
    }
  }
  return out;
}

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🍡  Mathmallow is running!');
  console.log(`      port: ${PORT}`);
  console.log(`      exercise sets: ${dirs.exerciseSetsDir}`);
  console.log(`      results:       ${dirs.resultsDir}`);
  console.log('');
  console.log('  Open in a browser:');
  console.log(`      http://localhost:${PORT}`);
  for (const addr of lanAddresses()) {
    console.log(`      http://${addr}:${PORT}   (from another device on this Wi-Fi)`);
  }
  console.log('');
});

function shutdown() {
  console.log('\n[mathmallow] shutting down...');
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
