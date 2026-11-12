import { cleanBreakdown, cleanText } from '../../lib/guard.js';

const MODEL = 'gpt-4o-mini';
const DAILY_LIMIT = 25;
const MAX_CHARS = 3000;
const MAX_INGREDIENTS = 100;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const NOT_FOUND = "i don't have this one, paste the ingredients and i'll break it down.";

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
- Emoji and exclamation points are not allowed. No pet names (girl, babe, bestie, hun). No marketing words (nourishing, luxurious, transformative, powerhouse, glow-giving).
- Describe things in flat, factual terms. Don't frame anything as a win or a warning.

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

const INGREDIENT_PROMPT = `You explain a single skincare ingredient for SEVEN MOMENTS, a skincare brand.

If the text is the name of a real skincare ingredient, explain what it does in the formula in one or two short sentences. Lowercase-forward, short sentences, contractions, flat and factual. No emoji, no exclamation points, no scores, no good/bad/safe/harsh/clean words, no product comparisons, no medical claims.
If you are not sure what it does, say "i'm not sure about this one."
If the text is not a skincare ingredient, set "is_ingredient" to false.

Respond only with JSON: {"is_ingredient": true or false, "name": "...", "explanation": "..."}`;

const PHOTO_PROMPT = `Read the ingredient list printed on this skincare product photo. Return the ingredient names exactly as printed, in the order printed. If there is no ingredient list in the photo, return an empty list.

Respond only with JSON: {"ingredients":["..."]}`;

const PARABEN = /paraben/i;
const SULFATE = /(lauryl|laureth|myreth|cocoyl|oleth)[\w\s.-]*sulf[ao]te/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function takeDailyQuota(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${day}:${await sha256Hex(ip)}`;
  const used = Number(await env.RATE_LIMIT.get(key)) || 0;
  if (used >= DAILY_LIMIT) return false;
  await env.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}

function splitIngredients(text) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const char of text.replace(/\n/g, ',')) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if ((char === ',' || char === ';') && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean).slice(0, MAX_INGREDIENTS);
}

function labelNotes(ingredients) {
  const names = ingredients.join(', ');
  const notes = [];
  if (!PARABEN.test(names)) notes.push('no parabens in this list.');
  if (!SULFATE.test(names)) notes.push('no sulfates in this list.');
  return notes;
}

async function callOpenAI(apiKey, messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`openai_${response.status}`);

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function requestBreakdown(apiKey, ingredients, productName) {
  const parsed = await callOpenAI(apiKey, [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Product name: ${productName || 'not given'}\nIngredient list: ${ingredients.join(', ')}`,
    },
  ]);

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

async function readPhotoIngredients(apiKey, imageDataUrl) {
  const parsed = await callOpenAI(apiKey, [
    { role: 'system', content: PHOTO_PROMPT },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } }],
    },
  ]);
  return (Array.isArray(parsed.ingredients) ? parsed.ingredients : [])
    .map((name) => String(name).trim())
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);
}

async function explainSingleIngredient(apiKey, text) {
  const parsed = await callOpenAI(apiKey, [
    { role: 'system', content: INGREDIENT_PROMPT },
    { role: 'user', content: text },
  ]);
  if (!parsed.is_ingredient) return null;
  const explanation = cleanText(parsed.explanation || '');
  if (!explanation) return null;
  return { name: String(parsed.name || text).slice(0, 100), explanation };
}

async function lookupProduct(query) {
  try {
    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    const match = (data.products || []).find((product) => product.ingredients_text && product.ingredients_text.trim());
    if (!match) return null;
    return {
      name: [match.brands, match.product_name].filter(Boolean).join(' ').slice(0, 120),
      ingredients: splitIngredients(match.ingredients_text),
    };
  } catch {
    return null;
  }
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

async function breakdownResponse(apiKey, { ingredients, productName, source }) {
  const meta = { mode: 'list', source, productName, ingredientCount: ingredients.length, caveat: CAVEAT };

  if (!apiKey) {
    const sample = sampleBreakdown(ingredients);
    sample.worth_knowing = labelNotes(ingredients);
    return json({ demo: true, ...meta, ...sample });
  }

  const breakdown = cleanBreakdown(await requestBreakdown(apiKey, ingredients, productName), ingredients);
  if (breakdown.groups.length === 0) throw new Error('empty');
  breakdown.worth_knowing.push(...labelNotes(ingredients));
  return json({ demo: false, ...meta, ...breakdown });
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'That photo is too large. Please use one under 4 MB.' }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'Please type a product name or ingredient, or upload a photo.' }, 400);
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const image = typeof payload.image === 'string' && payload.image.startsWith('data:image/') ? payload.image : '';
  if (!text && !image) {
    return json({ error: 'Please type a product name or ingredient, or upload a photo.' }, 400);
  }
  if (text.length > MAX_CHARS) {
    return json({ error: 'That is too long. Try pasting a shorter list.' }, 400);
  }

  if (!(await takeDailyQuota(env, request))) {
    return json({ error: "you've reached today's limit. please come back tomorrow." }, 429);
  }

  const apiKey = env.OPENAI_API_KEY;

  try {
    if (image) {
      if (!apiKey) return json({ error: 'Photo reading is available once the openai key is connected.' }, 503);
      const ingredients = await readPhotoIngredients(apiKey, image);
      if (ingredients.length === 0) {
        return json({ error: "i couldn't find an ingredient list in this photo. try a closer photo of the list." }, 422);
      }
      return await breakdownResponse(apiKey, { ingredients, productName: '', source: 'photo' });
    }

    if (/[,;\n]/.test(text)) {
      return await breakdownResponse(apiKey, { ingredients: splitIngredients(text), productName: '', source: 'list' });
    }

    if (apiKey) {
      const single = await explainSingleIngredient(apiKey, text);
      if (single) {
        return json({
          demo: false,
          mode: 'ingredient',
          caveat: CAVEAT,
          intro: '',
          groups: [{ label: single.name, ingredients: [single.name], explanation: single.explanation }],
          worth_knowing: [],
        });
      }
    }

    const product = await lookupProduct(text);
    if (product && product.ingredients.length > 0) {
      return await breakdownResponse(apiKey, { ingredients: product.ingredients, productName: product.name, source: 'product' });
    }

    if (!apiKey) {
      return json({ demo: true, mode: 'ingredient', caveat: CAVEAT, intro: '', groups: [{ label: text, ingredients: [text], explanation: 'placeholder text for this ingredient. the real explanation appears once the key is connected.' }], worth_knowing: [] });
    }

    return json({ error: NOT_FOUND }, 404);
  } catch (err) {
    console.error('decode failed:', err.message);
    return json({ error: 'We could not decode this right now. Please try again in a moment.' }, 502);
  }
}
