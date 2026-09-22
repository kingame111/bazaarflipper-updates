import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'0.5.9');
const joined=manifest.bundle.parts.map((p)=>fs.readFileSync(path.join(root,'../..',p.replace(/^\.\//,'')),'utf8').trim()).join('');
const gz=Buffer.from(joined,'base64');
const bundleHash=crypto.createHash('sha256').update(gz).digest('hex');
assert.equal(bundleHash,manifest.bundle.sha256,'bundle sha256 mismatch');
const payload=JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
for(const file of manifest.files){
  const bundled=Buffer.from(payload.files[file.path],'base64');
  const actualPath=path.join(root,file.path);
  const actual=fs.readFileSync(actualPath);
  assert.equal(crypto.createHash('sha256').update(bundled).digest('hex'),file.sha256,`manifest hash mismatch for ${file.path}`);
  assert.equal(Buffer.compare(bundled,actual),0,`bundled file differs from staging source: ${file.path}`);
}
assert.equal(Object.keys(payload.files).length,manifest.files.length);
console.log('v0.5.9 bundle round-trip/hash tests: PASS');
