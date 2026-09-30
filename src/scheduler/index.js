const cron = require('node-cron');
const { loadServers } = require('../services/serverConfig');
const { checkServer, collectServerInfo } = require('../services/statusChecker');

const INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 2);

async function runOnce() {
  const servers = loadServers();
  for (const server of servers) {
    const result = await checkServer(server);
    if (result.status === 'up') {
      try {
        await collectServerInfo(server);
      } catch (err) {
        console.error(`[scheduler] gagal ambil info server ${server.id}:`, err.message);
      }
    }
  }
}

function start() {
  const cronExpr = `*/${INTERVAL_MINUTES} * * * *`;
  console.log(`[scheduler] polling tiap ${INTERVAL_MINUTES} menit (${cronExpr})`);

  runOnce().catch((err) => console.error('[scheduler] cek awal gagal:', err.message));

  cron.schedule(cronExpr, () => {
    runOnce().catch((err) => console.error('[scheduler] cek terjadwal gagal:', err.message));
  });
}

module.exports = { start, runOnce };
