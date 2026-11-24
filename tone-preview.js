import { applyTone, isStructuralLine } from './vendor/fish-tone/tone.js';
import { repair } from './vendor/fish-tone/grammar.js';
import { thin } from './vendor/fish-tone/structures.js';
import { assess } from './vendor/fish-tone/judge.js';
import { insertMarks } from './vendor/fish-tone/marks.js';

export const previewLevels = ['off', 'light', 'normal', 'max'];

// Composition adapted from the upstream fish_tone tool. This runs only on text supplied to the preview.
export function previewTone(original, { strength = 'light', seed = 7, grammar = true } = {}) {
  if (strength === 'off') return original;
  const toned = applyTone(original, { strength, seed }).text;
  const repaired = grammar ? repair(toned, { seed, inject: true }).text : toned;
  let fence = false;
  const skip = line => {
    if (/^\s*(?:\x60\x60\x60|~~~)/.test(line)) {
      fence = !fence;
      return true;
    }
    return fence || line.includes('\x60') || line.includes('http') || isStructuralLine(line);
  };
  const marked = insertMarks(repaired, { level: 'light', seed, skip }).text;
  fence = false;
  return assess(marked).band === 'template' ? thin(marked, { skip }).text : marked;
}
