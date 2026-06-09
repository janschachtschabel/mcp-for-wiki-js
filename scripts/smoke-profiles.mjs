// Smoke test for WIKIJS_PROFILES (env-backed named credential profiles).
// The map KEY is a SECRET handle token (unguessable); "label" is the non-secret name.
// Start the server with these two profiles (same secrets as below) + preset=editor:
//   WIKIJS_PROFILES={"wzp_test_aaaaaaaaaaaaaaaaaaaaaaaa":{"label":"Alice","url":"https://wiki.alice.example","token":"dummy-A","preset":"readonly"},
//                    "wzp_test_bbbbbbbbbbbbbbbbbbbbbbbb":{"label":"Bob","url":"https://wiki.bob.example","token":"dummy-B","preset":"editor"}}
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.argv[2] || 'http://localhost:3031/mcp';
const A = 'wzp_test_aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'wzp_test_bbbbbbbbbbbbbbbbbbbbbbbb';

let bad = 0;
const ok = (l, p) => {
  console.log((p ? 'ok  - ' : 'FAIL- ') + l);
  if (!p) bad++;
};

async function connect(secret) {
  const t = new StreamableHTTPClientTransport(new URL(`${base}?token=${secret}`));
  const c = new Client({ name: 'smoke-profiles', version: '1.0.0' });
  await c.connect(t);
  return c;
}
const statusText = async (c) => (await c.callTool({ name: 'wiki_connection_status', arguments: {} })).content[0].text;
const createOf = (c) =>
  c.callTool({ name: 'wiki_page_create', arguments: { path: 'x', title: 'x', content: 'x', confirm: true } });

try {
  // --- Alice: readonly handle, instance A ---
  const alice = await connect(A);
  const aText = await statusText(alice);
  const a = JSON.parse(aText);
  console.log('Alice ->', JSON.stringify(a).slice(0, 150));
  ok('profile shows LABEL "Alice" (not the secret)', a.profile === 'Alice');
  ok('secret handle is NOT echoed in the response', !aText.includes(A));
  ok('url comes from Alice\'s profile', String(a.baseUrl).includes('wiki.alice.example'));
  const aCreate = await createOf(alice);
  ok(
    'Alice (readonly handle) write is policy-blocked',
    aCreate.isError === true && /blocked by the active permission policy/.test(aCreate.content[0].text),
  );
  await alice.close();

  // --- Bob: editor handle, instance B (different secret, key, rights, instance) ---
  const bob = await connect(B);
  const b = JSON.parse(await statusText(bob));
  console.log('Bob   ->', JSON.stringify(b).slice(0, 150));
  ok('profile shows LABEL "Bob"', b.profile === 'Bob');
  ok('url comes from Bob\'s profile (≠ Alice)', String(b.baseUrl).includes('wiki.bob.example'));
  const bCreate = await createOf(bob);
  ok(
    'Bob (editor handle) write is NOT policy-blocked',
    !/blocked by the active permission policy/.test(bCreate.content[0].text),
  );
  await bob.close();

  // --- a guessed/wrong secret must NOT inherit anyone's rights ---
  const guess = await connect('Alice'); // guessing the label as a token
  const gText = await statusText(guess);
  console.log('guess ->', gText.replace(/\s+/g, ' ').slice(0, 120));
  ok(
    'guessing the label "Alice" grants NEITHER her profile NOR her instance',
    !gText.includes('wiki.alice.example') && !/"profile"\s*:\s*"Alice"/.test(gText),
  );
  await guess.close();

  console.log(bad ? 'PROFILES SMOKE FAILED' : 'PROFILES SMOKE DONE');
  process.exitCode = bad ? 1 : 0;
} catch (e) {
  console.error('PROFILES SMOKE ERROR:', e?.message || e);
  process.exitCode = 1;
}
