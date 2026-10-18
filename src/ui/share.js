// Share a bot as a link: the code is compressed into the part of the URL after '#',
// which never gets sent to the server.
function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeBot(bot) {
  const json = new TextEncoder().encode(JSON.stringify({ n: bot.name, c: bot.color, s: bot.code }));
  if (typeof CompressionStream === 'function') {
    return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return 'r' + toBase64Url(json);
}

export async function decodeBot(data) {
  const kind = data[0];
  let bytes = fromBase64Url(data.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'r') throw new Error('Unknown share link format');
  const o = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof o.s !== 'string') throw new Error('Share link has no bot code');
  return { name: String(o.n || 'Shared Bot').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(o.c) ? o.c : null, code: o.s };
}

export async function shareLink(bot) {
  const base = location.href.split('#')[0];
  return `${base}#bot=${await encodeBot(bot)}`;
}
