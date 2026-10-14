// alerts.js — OWNER: S3. Owner alerts via Telegram (config.secrets.telegramBotToken / telegramChatId), no-op when unset,
// rate-limited. Events to alert on: new report, auto-mute, server start/crash/restart, degrade ≥ L2, backup failure.
//
// Service contract (FINAL): createAlerts({ config, log }) → alerts
//   alerts.enabled                       boolean
//   alerts.send(kind, text) → Promise<boolean>     kind: 'report'|'automute'|'start'|'crash'|'degrade'|'backup'|…
//
// FOUNDATION STUB: logs the alert, never touches the network. register() provides service 'alerts'.
export function createAlerts({ config, log } = {}) {
  const enabled = !!(config?.secrets?.telegramBotToken && config?.secrets?.telegramChatId);
  return {
    enabled,
    async send(kind, text) { log?.info('alert (stub, not sent)', { kind, text }); return false; },
  };
}

export function register(app) {
  app.provide('alerts', createAlerts({ config: app.config, log: app.log.child({ mod: 'alerts' }) }));
}
