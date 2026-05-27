import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export function detectPlatform() {
  if (process.env.WSL_DISTRO_NAME) return 'wsl';
  try {
    const proc = fs.readFileSync('/proc/version', 'utf8');
    if (proc.toLowerCase().includes('microsoft')) return 'wsl';
  } catch {}
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
}

export function caskName(fontName) {
  const kebab = fontName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return `font-${kebab}-nerd-font`;
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', timeout: 120000, ...opts }).trim();
}

async function installMacOS(fontName, log) {
  try {
    run('which brew');
  } catch {
    log(`Homebrew not found. Install from https://brew.sh/ then re-run.`);
    return false;
  }
  const cask = caskName(fontName);
  log(`Installing ${cask} via Homebrew...`);
  try {
    run(`brew install --cask ${cask}`, { stdio: 'inherit' });
    log(`Installed ${fontName} Nerd Font. Select it in your terminal app.`);
    return true;
  } catch (e) {
    log(`Failed to install ${cask}: ${e.message}`);
    return false;
  }
}

async function installLinux(fontName, log) {
  log(`Fetching latest Nerd Fonts release...`);
  try {
    const tag = run(`curl -sL https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4`);
    const url = `https://github.com/ryanoasis/nerd-fonts/releases/download/${tag}/${fontName}.zip`;
    const fontDir = path.join(os.homedir(), '.local', 'share', 'fonts', fontName);
    const zip = path.join(os.tmpdir(), `${fontName}.zip`);

    log(`Downloading ${fontName}.zip...`);
    run(`curl -fLo "${zip}" "${url}"`);
    run(`mkdir -p "${fontDir}"`);
    run(`unzip -o "${zip}" -d "${fontDir}"`);
    run(`fc-cache -fv`);
    run(`rm -f "${zip}"`);
    log(`Installed ${fontName} Nerd Font to ${fontDir}. Select it in your terminal app.`);
    return true;
  } catch (e) {
    log(`Failed: ${e.message}\nManual install: https://www.nerdfonts.com/`);
    return false;
  }
}

async function installWSL(fontName, log) {
  log(`WSL detected — fonts must be installed on the Windows host.`);
  let ps = 'powershell.exe';
  try { run(`which ${ps}`); } catch {
    ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    if (!fs.existsSync(ps)) {
      log(`PowerShell not found. Install the font manually on Windows from https://www.nerdfonts.com/`);
      return false;
    }
  }
  log(`Installing ${fontName} via PowerShell...`);
  try {
    const script = `
$tag = (Invoke-RestMethod 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest').tag_name;
$url = "https://github.com/ryanoasis/nerd-fonts/releases/download/$tag/${fontName}.zip";
$zip = "$env:TEMP\\${fontName}.zip";
Invoke-WebRequest -Uri $url -OutFile $zip;
Expand-Archive -Path $zip -DestinationPath "$env:TEMP\\${fontName}" -Force;
$fonts = (New-Object -ComObject Shell.Application).Namespace(0x14);
Get-ChildItem "$env:TEMP\\${fontName}\\*.ttf" | ForEach-Object { $fonts.CopyHere($_.FullName, 0x10) };
Remove-Item $zip, "$env:TEMP\\${fontName}" -Recurse -Force
`.trim();
    run(`${ps} -Command "& {${script}}"`, { stdio: 'inherit' });
    log(`Installed ${fontName} on Windows. Restart your terminal.`);
    return true;
  } catch (e) {
    log(`Failed: ${e.message}\nManual install: https://www.nerdfonts.com/`);
    return false;
  }
}

export async function installFont({ fontName, log } = {}) {
  fontName ??= 'JetBrainsMono';
  log ??= console.log;

  const platform = detectPlatform();
  log(`Platform: ${platform}`);

  switch (platform) {
    case 'macos': return installMacOS(fontName, log);
    case 'linux': return installLinux(fontName, log);
    case 'wsl':   return installWSL(fontName, log);
    default:
      log(`Unsupported platform. Install a Nerd Font manually from https://www.nerdfonts.com/`);
      return false;
  }
}

export default async function main(args) {
  let fontName = 'JetBrainsMono';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--font' && args[i + 1]) {
      fontName = args[++i];
    }
  }
  await installFont({ fontName });
}
