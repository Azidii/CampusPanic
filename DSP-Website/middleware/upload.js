import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const UPLOAD_DIR = fileURLToPath(new URL('../uploads/alerts/', import.meta.url));
const invalid = () => Object.assign(new Error('A valid JPEG, PNG or WebP image up to 10 MB is required.'), {statusCode:400});
export function saveAlertImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 10 * 1024 * 1024) throw invalid();
  const ext = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? '.jpg' :
    buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? '.png' :
    buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP' ? '.webp' : null;
  if (!ext) throw invalid();
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, {recursive:true});
  fs.writeFileSync(path.join(UPLOAD_DIR,filename),buffer,{flag:'wx'});
  return `/uploads/alerts/${filename}`;
}
export const uploadAlertImage = multer({
  storage:multer.memoryStorage(), limits:{fileSize:10*1024*1024},
  fileFilter(req,file,cb) {
    if (!/^\.(jpe?g|png|webp)$/i.test(path.extname(file.originalname)) || !['image/jpeg','image/png','image/webp'].includes(file.mimetype)) return cb(invalid());
    cb(null,true);
  }
});
export function saveBase64Image(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 14*1024*1024) throw invalid();
  const match = value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (value.startsWith('data:') && !match) throw invalid();
  const base64=match ? match[1] : value;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) throw invalid();
  return saveAlertImage(Buffer.from(base64,'base64'));
}
