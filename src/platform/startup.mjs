import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// XDG autostart is per-user; never write a system-wide desktop entry.
export function createStartup(app, { platform = process.platform, env = process.env, home = homedir(), executable = process.execPath } = {}) {
  const file = join(env.XDG_CONFIG_HOME || join(home, '.config'), 'autostart', 'codex-anywhere.desktop');
  function entry() {
    const path = env.APPIMAGE || executable;
    if (/[\r\n\0]/.test(path)) throw new Error('Invalid application path');
    const quoted = '"' + path.replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%') + '"';
    return `[Desktop Entry]\nType=Application\nName=Codex-Anywhere\nExec=${quoted}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  }
  return {
    async enabled() {
      if (platform !== 'linux') return app.getLoginItemSettings().openAtLogin;
      try { return (await readFile(file, 'utf8')) === entry(); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    },
    async set(enabled) {
      if (platform !== 'linux') { app.setLoginItemSettings({ openAtLogin: enabled }); return; }
      if (!enabled) { await rm(file, { force: true }); return; }
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, entry(), { mode: 0o600 });
    },
  };
}
