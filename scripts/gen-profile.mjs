// Generate secure, unguessable WIKIJS_PROFILES entries.
//
// The map KEY of each profile is a high-entropy SECRET (the handle token the user
// connects with). It must NOT be a guessable name — otherwise anyone could use
// someone else's handle. The human name goes into the non-secret "label" field.
//
// Usage:
//   node scripts/gen-profile.mjs "Alice:readonly" "Bob:editor"
//   WIKI_URL=https://wiki.example.org node scripts/gen-profile.mjs "Alice:readonly" "Bob:editor"
//
// Output: a ready-to-paste WIKIJS_PROFILES= line (fill in the real tokens) plus the
// per-user secret handle tokens to hand out.
import { randomBytes } from 'node:crypto';

const PREFIX = 'wzp_'; // wiki(js) proxy profile
const genHandle = () => PREFIX + randomBytes(24).toString('base64url'); // ~192 bits of entropy

const url = process.env.WIKI_URL || 'https://wiki.example.org';
const specs = process.argv.slice(2);
if (specs.length === 0) specs.push('User1:safe');

const profiles = {};
const handouts = [];
for (const spec of specs) {
  const [label, preset] = spec.split(':');
  const handle = genHandle();
  profiles[handle] = {
    label,
    url,
    token: `REPLACE_WITH_${(label || 'USER').toUpperCase()}_WIKIJS_API_KEY`,
    ...(preset ? { preset } : {}),
  };
  handouts.push({ label, handle, preset: preset || '(baseline)' });
}

console.log('# Paste into Vercel env (replace the REPLACE_WITH_… tokens with real, scoped Wiki.js keys):\n');
console.log('WIKIJS_PROFILES=' + JSON.stringify(profiles) + '\n');
console.log('# Hand each user their SECRET handle token (treat like a password):');
for (const h of handouts) {
  console.log(`#   ${h.label} [${h.preset}] → connect token: ${h.handle}`);
  console.log(`#       URL param : <deploy>/mcp?token=${h.handle}`);
  console.log(`#       header     : X-Wikijs-Token: ${h.handle}`);
}
