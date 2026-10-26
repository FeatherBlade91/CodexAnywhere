// Loaded after Playwright's loader, before Electron initializes its secret store.
const { app } = require('electron');
app.commandLine.removeSwitch('use-mock-keychain');
app.commandLine.removeSwitch('password-store');
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
