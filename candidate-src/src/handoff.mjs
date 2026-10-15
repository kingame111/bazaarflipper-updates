import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function resolveProjectRoot(baseDir, config) {
  if (process.platform !== 'win32') return baseDir;
  if (process.env.BAZAAR_PROJECT_ROOT) return path.resolve(process.env.BAZAAR_PROJECT_ROOT);

  const localConfig = readJsonFile(path.join(baseDir, 'handoff.json'), null);
  if (localConfig?.projectRoot) return path.resolve(localConfig.projectRoot);

  const configured = String(config.windowsProjectRoot || '').trim();
  if (configured && configured.toUpperCase() !== 'AUTO') return path.resolve(configured);

  return fs.existsSync('F:\\') ? 'F:\\bazzarFlipper' : 'C:\\bazzarFlipper';
}

export function loadHandoffConfig(projectRoot, baseDir, config) {
  const filePath = path.join(projectRoot, 'handoff.json');
  const fromProject = readJsonFile(filePath, null);
  const fromBase = readJsonFile(path.join(baseDir, 'handoff.json'), null);
  const raw = fromProject || fromBase || {};
  const tokenPath = path.join(projectRoot, 'handoff.key');
  let token = '';
  try { token = fs.readFileSync(tokenPath, 'utf8').trim(); } catch {}
  if (!token) {
    try { token = fs.readFileSync(path.join(baseDir, 'handoff.key'), 'utf8').trim(); } catch {}
  }
  return {
    filePath,
    role: String(raw.role || 'UNCONFIGURED').toUpperCase(),
    peerHost: String(raw.peerHost || '').trim(),
    projectRoot,
    handoffPort: Number(raw.handoffPort || config.handoffPort || 3211),
    token
  };
}

export function loadCollectorState(projectRoot, role = 'UNCONFIGURED') {
  const filePath = path.join(projectRoot, 'collector-state.json');
  const saved = readJsonFile(filePath, null);
  if (saved && typeof saved.active === 'boolean') return { filePath, active: saved.active };
  return { filePath, active: role === 'LAPTOP' ? false : true };
}

export function saveCollectorState(filePath, active) {
  writeJsonFile(filePath, { active: Boolean(active), updatedAt: Date.now() });
}

export function isAuthorized(req, token) {
  if (!token) return false;
  const received = String(req.headers['x-bazaarflipper-token'] || '');
  if (received.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

export async function readJsonBody(req, maxBytes = 6 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function receiveFile(req, destination, maxBytes = 512 * 1024 * 1024) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stream = fs.createWriteStream(destination, { flags: 'w' });
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBytes) throw new Error('Upload exceeds maximum allowed size');
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    return total;
  } catch (error) {
    try { stream.destroy(); } catch {}
    try { fs.rmSync(destination, { force: true }); } catch {}
    throw error;
  }
}
