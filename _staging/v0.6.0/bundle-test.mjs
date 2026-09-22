import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'0.6.0');
assert.equal(manifest.files.length,8);
const joined=manifest.bundle.parts
  .map((p)=>fs.readFileSync(path.join(root,'../..',p.replace(/^\.\//,'')),'utf8').trim())
  .join('');
const gz=Buffer.from(joined,'base64');
assert.equal(crypto.createHash('sha256').update(gz).digest('hex'),manifest.bundle.sha256);
const payload=JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
assert.deepEqual(Object.keys(payload.files).sort(),manifest.files.map(x=>x.path).sort());
for(const file of manifest.files){
  const bundled=Buffer.from(payload.files[file.path],'base64');
  const staged=fs.readFileSync(path.join(root,file.path));
  assert.equal(crypto.createHash('sha256').update(bundled).digest('hex'),file.sha256,`manifest hash mismatch: ${file.path}`);
  assert.equal(Buffer.compare(bundled,staged),0,`bundle differs from tested staging: ${file.path}`);
}
console.log('v0.6.0 bundle integrity: PASS');
