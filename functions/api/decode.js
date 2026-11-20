import { cleanBreakdown, cleanText } from '../../lib/guard.js';

const MODEL = 'gpt-5-nano';
const SEARCH_MODEL = 'gpt-4o-mini';
const DAILY_LIMIT = 25;
const MAX_CHARS = 3000;
const MAX_INGREDIENTS = 100;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const NOT_FOUND = "i don't have this one in my product list. paste the ingredients, or upload a photo of the ingredient list, and i'll break it down.";

const CAVEAT = [
  'before you panic or celebrate',
  "a label tells you what's in something, never how much. same ingredient, two products, completely different experience. so read this as what the formula is going for, not a prediction of what it'll do on you.",
].join('\n');

const SYSTEM_PROMPT = `You write short, friendly ingredient breakdowns for SEVEN MOMENTS. The audience is people who want to understand what is in a beauty or personal care product.

Explain what each ingredient in the list is doing in the formula, in plain English. Group the ingredients by the job they do (for example oil control, the blur, hydration, structure, color, preservation, fragrance, odor control), not by the order on the label. Every ingredient must appear in exactly one group.

Writing style:
- Lowercase-forward, short sentences, contractions. Conversational.
- Start with one opening line saying what the product is for, based on the ingredients. Work it out from what you see (for example "this one's for people whose face gets shiny" or "this is a deodorant meant to keep things fresh without aluminum"). If you genuinely can't tell, say "i'm not sure what this one's for, but here's what's in it."
- Each group gets a short label in plain words and one or two sentences.
- If an ingredient is obscure or you genuinely don't know what it does, say "i'm not sure about this one" instead of guessing. Common ingredients such as water, glycerin, and fragrance are known, so explain them.
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
- fragrance, if present: write a full sentence, like "there's fragrance in it."
- silicones and pilling, if present: explain it is about what someone layers, not a flaw
- oils that can feed fungal acne, if present
- anything commonly layered badly with other products
Leave the list empty if none apply.

Respond only with JSON in this shape:
{"intro":"...","groups":[{"label":"...","ingredients":["..."],"explanation":"..."}],"worth_knowing":["..."]}`;

const INGREDIENT_PROMPT = `You explain a single beauty or personal care ingredient for SEVEN MOMENTS.

If the text is the name of a real cosmetic, skincare, or personal care ingredient, explain what it does in the formula in one or two short sentences. Lowercase-forward, short sentences, contractions, flat and factual. No emoji, no exclamation points, no scores, no good/bad/safe/harsh/clean words, no product comparisons, no medical claims.
If you are not sure what it does, say "i'm not sure about this one."
If the text is not a cosmetic or personal care ingredient, set "is_ingredient" to false.

Respond only with JSON: {"is_ingredient": true or false, "name": "...", "explanation": "..."}

The "name" must be only the ingredient's common name, with no brand, product name, or percentage.`;

const PHOTO_PROMPT = `Read the ingredient list printed on this product photo. Return the ingredient names exactly as printed, in the order printed. If there is no ingredient list in the photo, return an empty list.

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
      reasoning_effort: 'minimal',
      max_completion_tokens: 1200,
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
  const name = String(parsed.name || text).replace(/\s*\d+(\.\d+)?\s*%/g, '').trim().slice(0, 100);
  return { name: name || text, explanation };
}

async function lookupProduct(query) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  if (words.length === 0) return null;
  try {
    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,ingredients_text`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    const match = (data.products || []).find((product) => {
      if (!product.ingredients_text || !product.ingredients_text.trim()) return false;
      const name = [product.brands, product.product_name].filter(Boolean).join(' ').toLowerCase();
      return words.every((word) => name.includes(word));
    });
    if (!match) return null;
    return {
      name: [match.brands, match.product_name].filter(Boolean).join(' ').slice(0, 120),
      ingredients: splitIngredients(match.ingredients_text),
    };
  } catch {
    return null;
  }
}

function parseIngredientsFromText(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.found && Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0) {
        return parsed.ingredients.map((n) => String(n).trim()).filter(Boolean).slice(0, MAX_INGREDIENTS);
      }
    }
  } catch {}
  const listMatch = text.match(/(?:ingredients?|INCI)[:\s]*([A-Z][a-zA-Z\s/()-]+(?:,\s*[A-Z][a-zA-Z\s/()-]+){4,})/);
  if (listMatch) {
    return listMatch[1].split(',').map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 80).slice(0, MAX_INGREDIENTS);
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const commaItems = line.split(',').map((s) => s.trim()).filter(Boolean);
    if (commaItems.length >= 5 && commaItems.every((s) => s.length < 80 && /^[A-Z]/.test(s))) {
      return commaItems.slice(0, MAX_INGREDIENTS);
    }
  }
  return null;
}

async function webSearchIngredients(apiKey, query) {
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        tools: [{ type: 'web_search', search_context_size: 'high' }],
        input: query,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const msg = (data.output || []).find((item) => item.type === 'message');
    const text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    if (!text) return null;
    return parseIngredientsFromText(text);
  } catch {
    return null;
  }
}

async function extractIngredientsFromName(apiKey, productName) {
  const parsed = await callOpenAI(apiKey, [
    { role: 'system', content: `You extract ingredient names from beauty product names. Given a product name, identify every cosmetic or skincare ingredient mentioned or abbreviated in it. Expand abbreviations (TXA = Tranexamic Acid, HA = Hyaluronic Acid, BHA = Salicylic Acid, AHA = Glycolic Acid, Vit C = Ascorbic Acid). Return JSON: {"ingredients": ["Arbutin", "Tranexamic Acid"]} or {"ingredients": []} if no ingredients are identifiable. Only list real cosmetic ingredients, not brand names or product types.` },
    { role: 'user', content: productName },
  ]);
  if (!Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) return null;
  return parsed.ingredients.map((n) => String(n).trim()).filter(Boolean).slice(0, 20);
}

function simplifyProductName(name) {
  return name
    .replace(/\d+(\.\d+)?%?/g, '')
    .replace(/[+]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function searchProductIngredients(apiKey, productName) {
  const result = await webSearchIngredients(apiKey,
    `Search the web for the full ingredient list (INCI list) of "${productName}". List every ingredient as printed on the product packaging or on a retailer or review site. Format: {"found": true, "ingredients": ["Water", "Glycerin", ...]} or {"found": false}. Do not make up ingredients.`
  );
  if (result) return result;
  const simple = simplifyProductName(productName);
  if (simple && simple.toLowerCase() !== productName.toLowerCase()) {
    return await webSearchIngredients(apiKey,
      `"${simple}" full ingredients list INCI. List all ingredients for this beauty product. Format: {"found": true, "ingredients": ["Water", "Glycerin", ...]} or {"found": false}.`
    );
  }
  return null;
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

  const raw = await requestBreakdown(apiKey, ingredients, productName);
  const coveredNames = new Set(raw.groups.flatMap((group) => group.ingredients.map((name) => name.trim().toLowerCase())));
  const missing = ingredients.filter((name) => !coveredNames.has(name.trim().toLowerCase()));
  if (missing.length > 0) {
    const retry = await requestBreakdown(apiKey, missing, productName);
    raw.groups.push(...retry.groups);
  }
  const breakdown = cleanBreakdown(raw);
  if (breakdown.groups.length === 0) throw new Error('empty');
  breakdown.worth_knowing.push(...labelNotes(ingredients));
  return json({ demo: false, ...meta, ...breakdown });
}

const PRODUCT_PROMPT = `You identify beauty and personal care product names. Given text typed by a user, return the brand and the full official product name, with spelling corrected and common abbreviations expanded (e.g. TXA → Tranexamic Acid, HA → Hyaluronic Acid, BHA → Beta Hydroxy Acid, AHA → Alpha Hydroxy Acid, Vit C → Vitamin C). The name must include the brand. Do not add ingredients. If the text is not a beauty, skincare, or personal care product or brand, return empty strings.

Respond only with JSON: {"brand": "...", "name": "..."}`;

async function identifyProduct(apiKey, text) {
  const parsed = await callOpenAI(apiKey, [
    { role: 'system', content: PRODUCT_PROMPT },
    { role: 'user', content: text },
  ]);
  return {
    brand: String(parsed.brand || '').trim().slice(0, 60),
    name: String(parsed.name || '').trim().slice(0, 120),
  };
}

async function tryIngredient(apiKey, text) {
  const single = await explainSingleIngredient(apiKey, text);
  if (!single) return null;
  return json({
    demo: false,
    mode: 'ingredient',
    caveat: CAVEAT,
    intro: '',
    groups: [{ label: single.name, ingredients: [single.name], explanation: single.explanation }],
    worth_knowing: [],
  });
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

    const singleWord = !/\s/.test(text);
    if (apiKey && singleWord) {
      try {
        const ingredient = await tryIngredient(apiKey, text);
        if (ingredient) return ingredient;
      } catch {}
    }

    const product = await lookupProduct(text);
    if (product && product.ingredients.length > 0) {
      return await breakdownResponse(apiKey, { ingredients: product.ingredients, productName: product.name, source: 'product' });
    }

    if (!apiKey) {
      return json({ demo: true, mode: 'ingredient', caveat: CAVEAT, intro: '', groups: [{ label: text, ingredients: [text], explanation: 'placeholder text for this ingredient. the real explanation appears once the key is connected.' }], worth_knowing: [] });
    }

    let info = { brand: '', name: '' };
    try {
      const [identified, webDirect] = await Promise.all([
        identifyProduct(apiKey, text),
        searchProductIngredients(apiKey, text),
      ]);
      info = identified;
      if (webDirect && webDirect.length > 0) {
        return await breakdownResponse(apiKey, { ingredients: webDirect, productName: info.name || text, source: 'web' });
      }
    } catch {}

    if (info.name) {
      const corrected = await lookupProduct(info.name);
      const brandWord = info.brand.toLowerCase().split(/\s+/)[0] || '';
      const brandMatches = !brandWord || corrected?.name.toLowerCase().includes(brandWord);
      if (corrected && brandMatches && corrected.ingredients.length > 0) {
        return await breakdownResponse(apiKey, { ingredients: corrected.ingredients, productName: corrected.name, source: 'product' });
      }
      if (simplifyProductName(info.name).toLowerCase() !== simplifyProductName(text).toLowerCase()) {
        const webCorrected = await searchProductIngredients(apiKey, info.name);
        if (webCorrected && webCorrected.length > 0) {
          return await breakdownResponse(apiKey, { ingredients: webCorrected, productName: info.name, source: 'web' });
        }
      }
    }

    const inputWords = text.trim().split(/\s+/).length;
    const brandWords = info.brand ? info.brand.trim().split(/\s+/).length : 0;
    if (info.brand && inputWords <= brandWords) {
      return json({ error: `i can see this is a ${info.brand} product. please type the full product name, or upload a photo of the ingredient list.` }, 404);
    }

    if (info.name && inputWords > brandWords + 1) {
      try {
        const nameIngredients = await extractIngredientsFromName(apiKey, info.name || text);
        if (nameIngredients && nameIngredients.length > 0) {
          return await breakdownResponse(apiKey, { ingredients: nameIngredients, productName: info.name || text, source: 'name' });
        }
      } catch {}
    }

    return json({ error: NOT_FOUND }, 404);
  } catch (err) {
    console.error('decode failed:', err.message);
    return json({ error: 'We could not decode this right now. Please try again in a moment.' }, 502);
  }
}
