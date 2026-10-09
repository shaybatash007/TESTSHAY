// Tiny zero-dependency server: serves the static avatar app and proxies chat to the Claude API.
// Usage: ANTHROPIC_API_KEY=sk-... node server.js   (PORT defaults to 5190)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5190;
const MODEL = process.env.AVATAR_MODEL || 'claude-sonnet-5-5';
const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const BASE = `You are "Noa", an original fictional character: an athletic, expressive young woman who talks with the user live through a phone app.
Reply in the user's language (default Hebrew). Keep replies short (1-3 sentences), natural and spoken-style, since they are read aloud.
Follow the user's instructions and play along with games, role-play, banter and coaching. Keep everything non-sexual and non-explicit; if asked for sexual content, steer playfully elsewhere without lecturing.
Begin every reply with exactly one mood tag in square brackets, one of: [happy] [playful] [surprised] [serious] [sad] [neutral]. Optionally follow it with one action tag when the user clearly asks you to do something physical: [do:flex] [do:smile] [do:turn] [do:front] [do:wave] [do:wink] [do:laugh] [do:hips] [do:serious] [do:tilt] [do:hair] [do:nod] [do:shake]. Then the text.`;

const MODES = {
  soft: 'Mode SOFT: gentle, warm, patient and encouraging. Speak softly, compliment often, never push.',
  normal: 'Mode NORMAL: friendly, witty, balanced and curious, like a good friend.',
  firm: 'Mode FIRM: tough, direct and demanding like a no-nonsense coach. Short commands, dry humor, high standards, never cruel or insulting.',
};

async function chat(req, res) {
  let body = '';
  for await (const c of req) body += c;
  const { mode = 'normal', messages = [] } = JSON.parse(body || '{}');
  const key = process.env.ANTHROPIC_API_KEY;
  res.setHeader('content-type', 'application/json');
  if (!key) return res.end(JSON.stringify({ offline: true }));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: `${BASE}\n${MODES[mode] || MODES.normal}`,
      messages: messages.slice(-20),
    }),
  });
  if (!r.ok) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: `upstream ${r.status}` }));
  }
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  const m = text.match(/^\[(\w+)\]\s*/);
  let rest = m ? text.slice(m[0].length) : text;
  const a = rest.match(/^\[do:(\w+)\]\s*/);
  if (a) rest = rest.slice(a[0].length);
  res.end(JSON.stringify({ mood: m ? m[1] : 'neutral', act: a ? a[1] : null, reply: rest }));
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/chat') return await chat(req, res);
      const path = req.url.split('?')[0];
      const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
      if (!file.startsWith(ROOT) || !TYPES[extname(file)] || file.endsWith('server.js')) {
        res.statusCode = 404;
        return res.end('not found');
      }
      res.setHeader('content-type', TYPES[extname(file)]);
      res.end(await readFile(file));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  })
  .listen(PORT, () => console.log(`Avatar app on http://localhost:${PORT}`));
