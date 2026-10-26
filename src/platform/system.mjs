import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

// All OS paths and native commands live here; callers can inject an OS in tests.
export function createSystem({ platform = process.platform, env = process.env, home = homedir(), run = execFileSync } = {}) {
  const support = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.LOCALAPPDATA || join(home, 'AppData', 'Local'))
    : (env.XDG_DATA_HOME || join(home, '.local', 'share'));
  return {
    platform,
    stateDir: env.CHATGPT_BRIDGE_STATE_DIR || join(support, 'CodexAnywhere'),
    ccPathsFile: join(platform === 'win32' ? (env.APPDATA || join(home, 'AppData', 'Roaming')) : support, 'com.ccswitch.desktop', 'app_paths.json'),
    detectProxy() {
      const explicit = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '';
      if (explicit) return explicit;
      const options = { encoding: 'utf8', windowsHide: true, timeout: 5000 };
      try {
        if (platform === 'win32') {
          const settings = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-ItemProperty "HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings" | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress'], options));
          if (!settings.ProxyEnable || typeof settings.ProxyServer !== 'string') return '';
          const value = settings.ProxyServer.includes('=') ? settings.ProxyServer.split(';').find(p => p.startsWith('https='))?.slice(6) : settings.ProxyServer;
          return value ? (value.includes('://') ? value : 'http://' + value) : '';
        }
        if (platform === 'darwin') return parseMacProxy(run('/usr/sbin/scutil', ['--proxy'], options));
        if (platform === 'linux') {
          const get = (schema, key) => run('gsettings', ['get', schema, key], options).trim().replace(/^'|'$/g, '');
          if (get('org.gnome.system.proxy', 'mode') !== 'manual') return '';
          for (const kind of ['https', 'http']) {
            const host = get('org.gnome.system.proxy.' + kind, 'host');
            const port = Number(get('org.gnome.system.proxy.' + kind, 'port'));
            if (host && !/[\s/@]/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535)
              return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
          }
        }
      } catch { /* System discovery is optional; explicit settings remain available. */ }
      return '';
    },
    isCCSwitchRunning() {
      const options = { encoding: 'utf8', windowsHide: true, timeout: 5000 };
      if (platform === 'win32') return /"cc-switch\.exe"/i.test(run('tasklist.exe', ['/FI', 'IMAGENAME eq cc-switch.exe', '/FO', 'CSV', '/NH'], options));
      // Inspect executable names, not command arguments that could match this app.
      return run('/bin/ps', ['-axo', 'comm='], options).split(/\r?\n/).some(line => /(?:^|\/)(?:cc-switch|CC Switch)$/i.test(line.trim()));
    },
  };
}

export function parseMacProxy(output) {
  const settings = Object.fromEntries([...output.matchAll(/^\s*(\w+)\s*:\s*(.*?)\s*$/gm)].map(m => [m[1], m[2]]));
  for (const kind of ['HTTPS', 'HTTP']) {
    if (settings[kind + 'Enable'] !== '1') continue;
    const host = settings[kind + 'Proxy'], port = Number(settings[kind + 'Port']);
    if (!host || /[\s/@]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
  }
  return '';
}

export const system = createSystem();
