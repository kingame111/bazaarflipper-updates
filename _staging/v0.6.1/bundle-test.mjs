import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'0.6.1');
const repoRoot=path.resolve(root,'../..');
const joined=manifest.bundle.parts.map((p)=>fs.readFileSync(path.join(repoRoot,p.replace(/^\.\//,'')),'utf8').trim()).join('');
const gz=Buffer.from(joined,'base64');
const sha=(b)=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(gz),manifest.bundle.sha256);
const payload=JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
assert.equal(Object.keys(payload.files).length,manifest.files.length);
for(const file of manifest.files){
  const bundled=Buffer.from(payload.files[file.path],'base64');
  const actual=fs.readFileSync(path.join(root,file.path));
  assert.equal(sha(bundled),file.sha256,`hash mismatch ${file.path}`);
  assert.equal(Buffer.compare(bundled,actual),0,`bundle mismatch ${file.path}`);
}
console.log('v0.6.1 bundle integrity: PASS');
