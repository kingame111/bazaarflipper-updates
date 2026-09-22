import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = path.resolve(arg('project') || '.');
const stagingRoot = path.resolve(arg('staging') || '');
const parentPid = Number(arg('parent')) || 0;
const port = Number(arg('port')) || 3210;
const host = arg('host') || '127.0.0.1';
const logsDir = path.join(projectRoot,'logs');
fs.mkdirSync(logsDir,{recursive:true});
const updaterLog = path.join(logsDir,'update.log');
const startupLog = path.join(logsDir,'update-startup.log');
const log = (message) => { try { fs.appendFileSync(updaterLog,`${new Date().toISOString()} ${message}\n`,'utf8'); } catch {} };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForParentExit() {
  if (!parentPid) return;
  for (let i = 0; i < 240; i += 1) {
    try { process.kill(parentPid, 0); } catch { return; }
    await sleep(250);
  }
  throw new Error('Old BazaarFlipper process did not exit within 60 seconds');
}

function copyFileAtomic(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.update-new`;
  fs.copyFileSync(source, temp);
  fs.rmSync(target, { force: true });
  fs.renameSync(temp, target);
}

function launchServer() {
  const logFd=fs.openSync(startupLog,'a');
  try {
    if (process.platform === 'win32') {
      const batchPath = path.join(projectRoot, 'start-bazaarflip.bat');
      const command = `call "${batchPath.replace(/"/g, '""')}"`;
      const child = spawn('cmd.exe', ['/d', '/c', command], {
        cwd: projectRoot,
        detached: true,
        stdio: ['ignore',logFd,logFd],
        windowsHide: false
      });
      child.unref();
      return child.pid;
    }
    const child = spawn(process.execPath, [path.join(projectRoot, 'server.mjs')], {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore',logFd,logFd]
    });
    child.unref();
    return child.pid;
  } finally {
    try { fs.closeSync(logFd); } catch {}
  }
}

async function healthCheck(expectedVersion) {
  const started=Date.now();
  let lastError='';
  for (let i = 0; i < 240; i += 1) {
    try {
      const response = await fetch(`http://${host}:${port}/api/status`, { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json();
        if (!expectedVersion || body.version === expectedVersion) {
          log(`health check passed for v${body.version} after ${Date.now()-started}ms`);
          return true;
        }
        lastError=`unexpected version ${body.version}`;
      } else lastError=`HTTP ${response.status}`;
    } catch (error) { lastError=error instanceof Error?error.message:String(error); }
    await sleep(500);
  }
  log(`health check failed after ${Date.now()-started}ms: ${lastError}`);
  return false;
}

function terminate(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

async function main() {
  const manifestPath = path.join(stagingRoot, 'staged-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  log(`applying v${manifest.version}; waiting for old pid ${parentPid}`);
  await waitForParentExit();

  const backupRoot = path.join(projectRoot, 'data', 'updates', `backup-${Date.now()}-${manifest.version}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  const copied = [];

  try {
    for (const item of manifest.files) {
      const rel = item.path;
      const source = path.join(stagingRoot, rel);
      const target = path.join(projectRoot, rel);
      if (fs.existsSync(target)) {
        const backup = path.join(backupRoot, rel);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(target, backup);
      }
      copyFileAtomic(source, target);
      copied.push(rel);
    }

    log(`files copied; launching v${manifest.version}`);
    const newPid = launchServer();
    if (!(await healthCheck(String(manifest.version)))) {
      terminate(newPid);
      await sleep(1000);
      throw new Error(`v${manifest.version} failed health check after 120 seconds; see ${startupLog}`);
    }

    fs.writeFileSync(path.join(projectRoot, 'data', 'last-update.json'), JSON.stringify({
      ok: true, version: manifest.version, updatedAt: Date.now(), backupRoot
    }, null, 2), 'utf8');
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    log(`update to v${manifest.version} completed successfully`);
  } catch (error) {
    log(`update failed: ${error instanceof Error?error.stack||error.message:String(error)}; rolling back`);
    for (const rel of copied.reverse()) {
      const target = path.join(projectRoot, rel);
      const backup = path.join(backupRoot, rel);
      if (fs.existsSync(backup)) copyFileAtomic(backup, target);
      else fs.rmSync(target, { force: true });
    }
    launchServer();
    fs.writeFileSync(path.join(projectRoot, 'data', 'last-update.json'), JSON.stringify({
      ok: false, attemptedVersion: manifest.version, failedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error), backupRoot, startupLog
    }, null, 2), 'utf8');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log(`fatal updater error: ${error?.stack||error}`);
  process.exitCode = 1;
});
