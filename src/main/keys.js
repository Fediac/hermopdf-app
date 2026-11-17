'use strict';
const path = require('path');
// Gömülü Ed25519 açık anahtarları (spki PEM). Bunlar gizli değildir.
// Özel anahtarlar asla bu depoya girmez; yalnızca sahibinin bilgisayarında (~/.ultronix-keys) durur.
//  - license-live-2026a : gerçek Lifetime Pro lisansları ve onların iptal listesi
//  - license-sbx-2026a  : Sandbox (test) lisansları — paketlenmiş sürüm bunları kabul etmez
//  - release-2026a      : güncelleme bildirim dosyası (latest.json)

const KEYS = Object.freeze({
  'license-live-2026a': Object.freeze({
    env: 'live',
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAf8Vg1BppCu/E4JvKI5JpSzFxGj3Rn588uP962MUzJYI=\n-----END PUBLIC KEY-----\n',
  }),
  'license-sbx-2026a': Object.freeze({
    env: 'sandbox',
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAmTO9omIXHsbpy9Vyfy51XQMgCqpX39bHSDKAgd2Ua0M=\n-----END PUBLIC KEY-----\n',
  }),
  'release-2026a': Object.freeze({
    env: 'release',
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEANySCp69PX4jrpwnOccUjrrhcO8RpQkys3KWjUoerzWU=\n-----END PUBLIC KEY-----\n',
  }),
});

const ENVS = ['live', 'sandbox', 'release'];

// Yalnızca test: ek anahtarlar (JSON {kid: {pem, env}}). Gömülü kimliklerin üzerine yazılamaz.
function withTestKeys(json) {
  const out = { ...KEYS };
  if (!json) return out;
  let extra;
  try { extra = JSON.parse(json); } catch (e) { return out; }
  if (!extra || typeof extra !== 'object') return out;
  for (const [kid, k] of Object.entries(extra)) {
    if (KEYS[kid] || !k || typeof k.pem !== 'string' || !ENVS.includes(k.env)) continue;
    out[kid] = { env: k.env, pem: k.pem };
  }
  return out;
}

// Geliştirme çalıştırması mı (repo içinden `electron .`)? app.isPackaged YALNIZCA exe adına bakar
// (electron.exe → false): kurulu "HermoPDF.exe"yi "electron.exe" adıyla kopyalamak onu false yapar.
// Bu yüzden ek olarak uygulama kodunun Electron'un resources klasörünün (app.asar / app) DIŞINDA olması aranır.
function isDevRun({ isPackaged, appPath, resourcesPath }) {
  if (isPackaged !== false || typeof appPath !== 'string' || typeof resourcesPath !== 'string' || !appPath || !resourcesPath) return false;
  const rel = path.relative(path.resolve(resourcesPath), path.resolve(appPath));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

// Lisans doğrulamasının ayarları. Sandbox (test) lisansları ve test anahtarları yalnızca geliştirme çalıştırmasında;
// kurulu sürümde hiçbir ortam değişkeni bunları açamaz.
function licensingConfig({ isPackaged, appPath, resourcesPath, env = {} }) {
  const dev = isDevRun({ isPackaged, appPath, resourcesPath });
  const devTest = dev && env.PDFUSTA_TEST === '1';
  return { dev, devTest, allowSandbox: dev, keys: devTest ? withTestKeys(env.ULTRONIX_TEST_KEYS) : { ...KEYS } };
}

module.exports = { KEYS, withTestKeys, isDevRun, licensingConfig };
