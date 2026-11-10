'use strict';
// Couleurs personnalisables du menu de gauche et de l'en-tête (fond bleu par défaut).
// Valeur : { sidebar: '#RRGGBB' | null, header: '#RRGGBB' | null } — null = couleur par défaut de l'application.
// Le texte du menu et de l'en-tête reste blanc : une couleur trop claire est refusée (contraste minimal 4,5:1).
const { z } = require('zod');

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LUMINANCE = 0.18;   // luminance relative maximale pour un texte blanc lisible (WCAG AA)

function relLum(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

const navColor = z.string().regex(HEX, 'Couleur au format #RRGGBB')
  .refine(v => relLum(v) <= MAX_LUMINANCE, 'Couleur trop claire : le texte blanc du menu deviendrait illisible. Choisissez une teinte plus foncée.');

const navColorsSchema = z.object({
  sidebar: navColor.nullable().optional(),
  header: navColor.nullable().optional()
}).strict().transform(v => ({ sidebar: v.sidebar || null, header: v.header || null }));

module.exports = { navColorsSchema, relLum, MAX_LUMINANCE };
