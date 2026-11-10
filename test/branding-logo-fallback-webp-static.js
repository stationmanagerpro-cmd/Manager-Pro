'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = fs.readFileSync(path.join(root, 'src/files.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'public/ext-core.js'), 'utf8');
if (!/slice\(8,\s*12\)\.toString\(\)\s*===\s*'WEBP'/.test(files) || !/webp:\s*'image\/webp'/.test(files)) {
  throw new Error('Le stockage des images doit détecter et servir WebP à partir des octets');
}
if (!core.includes('data-name=') || !core.includes('initials(im.dataset.name')) {
  throw new Error('Une image de station absente doit afficher les initiales, jamais un point d’interrogation');
}
if (!core.includes('image/png,image/jpeg,image/webp')) {
  throw new Error('Le sélecteur de logo doit accepter PNG, JPEG et WebP');
}
console.log('OK branding-logo-fallback-webp-static');
