const http = require('http');
const fs = require('fs');
const path = require('path');
const { cleanBreakdown } = require('./lib/guard');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_CHARS = 3000;
const MAX_INGREDIENTS = 100;
const MAX_PRODUCT_NAME = 100;
const MAX_BODY_BYTES = 10 * 1024;

const CAVEAT = [
  'before you panic or celebrate',
  "a label tells you what's in something, never how much. same ingredient, two products, completely different experience. so read this as what the formula is going for, not a prediction of what it'll do on you.",
].join('\n');

const SYSTEM_PROMPT = `You write short, friendly ingredient breakdowns for SEVEN MOMENTS, a skincare brand. The audience is people who want to understand a product's formula.

Explain what each ingredient in the list is doing in the formula, in plain English. Group the ingredients by the job they do (for example oil control, the blur, hydration, structure, color, preservation, fragrance), not by the order on the label. Every ingredient must appear in exactly one group.

Writing style:
- Lowercase-forward, short sentences, contractions. Conversational.
- Start with one opening line saying what the product is for, before any ingredient. Work it out from the ingredients (for example "this one's for people whose face gets shiny"). If you can't tell, say so honestly.
- Each group gets a short label in plain words and one or two sentences.
- If an ingredient is obscure or you are not sure what it does, say "i'm not sure about this one" instead of guessing.
- Emoji are not allowed. No pet names (girl, babe, bestie, hun). No marketing words (nourishing, luxurious, transformative, powerhouse, glow-giving).

Never:
- Give scores, ratings, grades, or percentages.
- Use the words good, bad, toxic, clean, harsh, or safe.
- Tell anyone to stop using something or to buy something else.
- Mention or compare any other product.
- Give medical advice, diagnose, or say an ingredient causes a condition.
- Say how much of an ingredient is in the product.
- Guess when you don't know.

"worth_knowing" is a short list of plain sentences. Include only what applies to these ingredients:
- fragrance, if present
- silicones and pilling, if present: explain it is about what someone layers, not a flaw
- oils that can feed fungal acne, if present
- anything commonly layered badly with other products
Leave the list empty if none apply.

Respond only with JSON in this shape:
{"intro":"...","groups":[{"label":"...","ingredients":["..."],"explanation":"..."}],"worth_knowing":["..."]}`;

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseIngredients(text) {
  return text
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);
}

async function requestBreakdown(ingredients, productName) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Product name: ${productName || 'not given'}\nIngredient list: ${ingredients.join(', ')}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`openai_${response.status}`);

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);

  return {
    intro: String(parsed.intro || ''),
    groups: (Array.isArray(parsed.groups) ? parsed.groups : [])
      .filter((group) => group && group.label && group.explanation && Array.isArray(group.ingredients))
      .slice(0, 12)
      .map((group) => ({
        label: String(group.label).slice(0, 80),
        ingredients: group.ingredients.map((name) => String(name).slice(0, 100)).slice(0, 40),
        explanation: String(group.explanation).slice(0, 600),
      })),
    worth_knowing: (Array.isArray(parsed.worth_knowing) ? parsed.worth_knowing : [])
      .map((note) => String(note).slice(0, 300))
      .slice(0, 8),
  };
}

function sampleBreakdown(ingredients) {
  return {
    intro: 'demo preview. this is sample layout only, so connect the openai key to get a real breakdown.',
    groups: [
      {
        label: 'sample group',
        ingredients,
        explanation: 'placeholder text for this group. the real explanation appears once the key is connected.',
      },
    ],
    worth_knowing: [],
  };
}

async function handleDecode(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    const status = err.message === 'too_large' ? 413 : 400;
    return sendJson(res, status, { error: 'Please paste a shorter ingredient list.' });
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!text.trim()) {
    return sendJson(res, 400, { error: 'Please paste an ingredient list first.' });
  }
  if (text.length > MAX_CHARS) {
    return sendJson(res, 400, { error: 'That list is too long. Try splitting it into two parts.' });
  }

  const ingredients = parseIngredients(text);
  if (ingredients.length === 0) {
    return sendJson(res, 400, { error: 'Please paste an ingredient list first.' });
  }

  const productName = typeof payload.productName === 'string'
    ? payload.productName.trim().slice(0, MAX_PRODUCT_NAME)
    : '';
  const meta = { productName, ingredientCount: ingredients.length, caveat: CAVEAT };

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 200, { demo: true, ...meta, ...sampleBreakdown(ingredients) });
  }

  try {
    const raw = await requestBreakdown(ingredients, productName);
    const breakdown = cleanBreakdown(raw, ingredients);
    if (breakdown.groups.length === 0) throw new Error('empty');
    return sendJson(res, 200, { demo: false, ...meta, ...breakdown });
  } catch (err) {
    console.error('decode failed:', err.message);
    return sendJson(res, 502, {
      error: 'We could not decode this list right now. Please try again in a moment.',
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX_PATH).pipe(res);
  }
  if (req.method === 'POST' && req.url === '/api/decode') {
    return handleDecode(req, res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`SEVEN MOMENTS ingredient tool running at http://localhost:${PORT}`);
});
