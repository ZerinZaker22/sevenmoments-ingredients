import { cleanBreakdown, cleanText } from '../../lib/guard.js';

const MODEL = 'gpt-5-nano';
const FALLBACK_MODEL = 'gpt-4o-mini';
const SEARCH_MODEL = 'gpt-4o-mini';
// Small print needs a model that accepts photos at original detail; gpt-5-nano shrinks them and invents what it can't read.
const PHOTO_MODELS = ['gpt-5.4-mini', 'gpt-4.1-mini'];
const DAILY_LIMIT = 25;
const MAX_CHARS = 6000;
const MAX_INGREDIENTS = 100;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
// Cloudflare drops responses after 100 s, so every request finishes well inside that.
const REQUEST_BUDGET_MS = 85000;
const NOT_FOUND = "i don't have this one in my product list. paste the ingredients, or upload a photo of the ingredient list, and i'll break it down.";

const CAVEAT = [
  'before you panic or celebrate',
  "a label tells you what's in something, never how much. same ingredient, two products, completely different experience. so read this as what the formula is going for, not a prediction of what it'll do on you.",
].join('\n');

const SYSTEM_PROMPT = `You write short, friendly ingredient breakdowns for SEVEN MOMENTS. The audience is people who want to understand what is in a beauty or personal care product.

Explain what each ingredient in the list is doing in the formula, in plain English. Group the ingredients by the job they do (for example oil control, the blur, hydration, structure, color, preservation, fragrance, odor control), not by the order on the label. The ingredients are numbered. In "items", list the numbers that belong to a group. Every number must appear in exactly one group.

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
Leave the list empty if none apply. Write each note as a plain sentence about this product. Only add a note when it is true for these ingredients. Never write a note saying something is absent or not listed, and never copy the bullet wording above as a heading.

Respond only with JSON in this shape:
{"intro":"...","groups":[{"label":"...","items":[1,2],"explanation":"..."}],"worth_knowing":["..."]}`;

const INGREDIENT_PROMPT = `You explain a single beauty or personal care ingredient for SEVEN MOMENTS.

If the text is the name of a real cosmetic, skincare, or personal care ingredient, explain what it does in the formula in one or two short sentences. Lowercase-forward, short sentences, contractions, flat and factual. No emoji, no exclamation points, no scores, no good/bad/safe/harsh/clean words, no product comparisons, no medical claims.
If you are not sure what it does, say "i'm not sure about this one."
If the text is not a cosmetic or personal care ingredient, set "is_ingredient" to false.

Respond only with JSON: {"is_ingredient": true or false, "name": "...", "explanation": "..."}

The "name" must be only the ingredient's common name, with no brand, product name, or percentage.`;

const PHOTO_PROMPT = `You transcribe photos of beauty and personal care products. Report only what you can see in the photo. The label may be sideways, upside down, curved, small, or partly covered: read it in whatever direction it runs.

Never complete, correct, or guess an ingredient from memory. If you can't make out a word's letters, leave that ingredient out and lower "legibility". A short true answer is better than a long invented one.

Respond only with JSON:
{"turn": 0 or 90 or 180 or 270, "has_list": true or false, "legibility": "full" or "partial" or "none", "ingredients": ["..."], "brand": "...", "product": "..."}

- turn: how many degrees clockwise the photo must be turned so the ingredient list reads upright, left to right. 0 if it already does, 90 if its lines run from bottom to top, 270 if its lines run from top to bottom, 180 if it is upside down.
- has_list: true only if a printed ingredient list is in the photo, usually under a heading such as Ingredients, Ingrédients, INCI, Zutaten, Active ingredients, or Inactive ingredients. A product name, claims, directions, or a box that highlights a few key ingredients is not an ingredient list.
- legibility: "full" if you read every ingredient in the list, "partial" if some of it is blurred, cut off, or hidden, "none" if there's no list or you can't read it.
- ingredients: one ingredient per item, in printed order, spelled as printed. A long name often wraps onto the next line, sometimes with a hyphen: join it into one item. Keep a bracketed name with its ingredient. Leave out headings, footnotes, and directions. Include both active and inactive ingredients, and every list if the pack has several. If the list is repeated in several languages, include it once, in English or INCI names.
- brand and product: as printed on the pack, if you can see them, otherwise empty strings. The product is its full specific name, not its claims. If only a general type is visible, such as "foundation" or "face cream", use an empty string.`;

const PRODUCT_PROMPT = `You identify beauty and personal care product names. Given text typed by a user, return the brand and the full official product name, with spelling corrected and common abbreviations expanded (e.g. TXA → Tranexamic Acid, HA → Hyaluronic Acid, BHA → Beta Hydroxy Acid, AHA → Alpha Hydroxy Acid, Vit C → Vitamin C). The name must include the brand. If the text is only a brand, even a misspelled one (e.g. "cerave", "cerve" → CeraVe, "cetaphill" → Cetaphil), return the brand's correct spelling and an empty name. If the text is only an ingredient (e.g. "shea butter"), return empty strings. Do not add ingredients. If the text is not a beauty, skincare, or personal care product or brand, return empty strings.

Respond only with JSON: {"brand": "...", "name": "..."}`;

const NAME_INGREDIENTS_PROMPT = `You extract ingredient names from beauty product names. Given a product name, identify every cosmetic or skincare ingredient mentioned or abbreviated in it. Expand abbreviations (TXA = Tranexamic Acid, HA = Hyaluronic Acid, BHA = Salicylic Acid, AHA = Glycolic Acid, Vit C = Ascorbic Acid). Return JSON: {"ingredients": ["Arbutin", "Tranexamic Acid"]} or {"ingredients": []} if no ingredients are identifiable. Only list real cosmetic ingredients, not brand names or product types.`;

const PARABEN = /paraben/i;
const SULFATE = /(lauryl|laureth|myreth|cocoyl|oleth)[\w\s.-]*sulf[ao]te/i;
const LIST_LABEL = /^[\s\S]{0,40}?\b(ingredients?|ingr[ée]dients?|inci|composition)\b[^:\n]{0,30}:\s*/i;
const SIZE = /^\s*\d+([.,]\d+)?\s*(ml|l|oz|fl\.?\s*oz|g|kg|mg|pcs?|count|ct)\b/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function timeLeft(ctx) {
  return ctx.deadline - Date.now();
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

function cleanIngredientName(name) {
  return String(name)
    .replace(/^[\s.*•·\-–]+|[\s.*•·]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Positions of opening brackets that are never closed, so one missed bracket can't swallow the rest of a list.
function unclosedBrackets(text) {
  const open = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') open.push(i);
    if (text[i] === ')' || text[i] === ']') open.pop();
  }
  return new Set(open);
}

function splitIngredients(text) {
  const items = [];
  let depth = 0;
  let current = '';
  const body = text
    .replace(LIST_LABEL, '')
    .replace(/\r/g, '')
    .replace(/[,;.\s]*\b(in)?active ingredients?\s*:/gi, ',')
    .replace(/[、，；]/g, ',')
    .replace(/\n/g, ',');
  const ignore = unclosedBrackets(body);
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if ((char === '(' || char === '[') && !ignore.has(i)) depth += 1;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    // "1,2-Hexanediol" is one ingredient: a comma between numbers leading to a hyphen is part of the name.
    const insideName = char === ',' && /\d$/.test(current) && /^\d+(,\d+)*-[a-z]/i.test(body.slice(i + 1));
    if (',;•·|'.includes(char) && depth === 0 && !insideName) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  const list = items.map(cleanIngredientName).filter((item) => item.length > 1);
  return list.slice(0, MAX_INGREDIENTS);
}

function looksLikeList(text) {
  if (LIST_LABEL.test(text)) return true;
  if (!/[,;\n•·|]/.test(text)) return false;
  const items = splitIngredients(text);
  if (items.length >= 3) return true;
  if (items.length === 2 && !SIZE.test(items[1])) return true;
  return false;
}

function stripSize(text) {
  return text.split(/[,;|]/).filter((part, i) => i === 0 || !SIZE.test(part)).join(' ').trim();
}

function nameKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NOTE_HEADING = /^\s*(fragrance(, if present)?|silicones?( and pilling)?|oils that can feed fungal acne|anything commonly layered badly( with other products)?|layering)\s*[:\-–]\s*/i;
const ABSENCE = /\b(no|not|isn't|aren't|doesn't|don't|without|none)\b[^.]*\b(listed|present|in (it|this|the list)|call(s)? out|obvious|included|separate|specified|mentioned)/i;

// The model sometimes echoes the checklist headings or adds "nothing here" notes; keep only real, applicable notes.
function tidyNotes(notes, ingredients) {
  const names = ingredients.join(' ').toLowerCase();
  const hasFragrance = /fragrance|parfum|perfume|aroma/.test(names);
  const seen = new Set();
  return notes
    .map((note) => note.replace(NOTE_HEADING, '').trim())
    .filter((note) => {
      const text = note.toLowerCase();
      if (!note || ABSENCE.test(text) || /not sure/.test(text)) return false;
      if (/fragrance|scent|parfum/.test(text) && !hasFragrance) return false;
      const key = text.replace(/[^a-z]/g, '').slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((note) => note.charAt(0).toLowerCase() + note.slice(1));
}

function labelNotes(ingredients) {
  const names = ingredients.join(', ');
  const notes = [];
  if (!PARABEN.test(names)) notes.push('no parabens in this list.');
  if (!SULFATE.test(names)) notes.push('no sulfates in this list.');
  return notes;
}

function parseModelJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('bad_json');
}

async function callOpenAI(apiKey, messages, { model, maxTokens, timeoutMs }) {
  const body = {
    model,
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages,
  };
  if (model === 'gpt-5-nano') body.reasoning_effort = 'minimal';
  if (model.startsWith('gpt-5.4')) body.reasoning_effort = 'none';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    console.error('openai error', model, response.status, (await response.text()).slice(0, 200));
    throw new Error(`openai_${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) throw new Error('no_choice');
  if (choice.finish_reason === 'length') throw new Error('truncated');
  return parseModelJson(choice.message.content);
}

// Tries the main model twice, then a second model, inside the request's time budget.
async function askAI(apiKey, ctx, messages, { maxTokens = 1200, models = [MODEL, MODEL, FALLBACK_MODEL] } = {}) {
  let lastError = new Error('out_of_time');
  let tokens = maxTokens;
  for (const model of models) {
    const left = timeLeft(ctx) - 3000;
    if (left < 5000) break;
    try {
      return await callOpenAI(apiKey, typeof messages === 'function' ? messages(model) : messages, { model, maxTokens: tokens, timeoutMs: Math.min(30000, left) });
    } catch (err) {
      lastError = err;
      console.error(`ai call failed (${model}):`, err.message);
      if (err.message === 'openai_401' || err.message === 'openai_403') break;
      if (err.message === 'truncated') tokens = Math.min(tokens * 2, 16000);
    }
  }
  throw lastError;
}

async function requestBreakdown(apiKey, ctx, ingredients, productName, models) {
  const parsed = await askAI(apiKey, ctx, [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Product name: ${productName || 'not given'}\nIngredients:\n${ingredients.map((name, i) => `${i + 1}. ${name}`).join('\n')}`,
    },
  ], { maxTokens: Math.min(8000, 1500 + ingredients.length * 90), models });

  // Names come from the list, never from the model, so it can't invent or misspell an ingredient.
  const used = new Set();
  const pick = (items) => (Array.isArray(items) ? items : [])
    .map((item) => Number(item))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= ingredients.length && !used.has(n) && used.add(n))
    .map((n) => ingredients[n - 1]);

  return {
    intro: String(parsed.intro || ''),
    groups: (Array.isArray(parsed.groups) ? parsed.groups : [])
      .filter((group) => group && group.label && group.explanation)
      .slice(0, 14)
      .map((group) => ({
        label: String(group.label).slice(0, 80),
        ingredients: pick(group.items),
        explanation: String(group.explanation).slice(0, 600),
      }))
      .filter((group) => group.ingredients.length > 0),
    worth_knowing: (Array.isArray(parsed.worth_knowing) ? parsed.worth_knowing : [])
      .map((note) => String(note).slice(0, 300))
      .slice(0, 8),
  };
}

function parsePhoto(parsed) {
  const items = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
  const seen = new Set();
  const ingredients = items
    .flatMap((item) => splitIngredients(String(item).replace(/\s*\n\s*/g, ' ')))
    .filter((name) => {
      const key = nameKey(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_INGREDIENTS);
  return {
    turn: [90, 180, 270].includes(Number(parsed.turn)) ? Number(parsed.turn) : 0,
    hasList: Boolean(parsed.has_list),
    ingredients: parsed.has_list ? ingredients : [],
    legibility: parsed.legibility,
    brand: String(parsed.brand || '').trim().slice(0, 60),
    product: String(parsed.product || '').trim().slice(0, 120),
  };
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function sameIngredient(a, b) {
  const close = (x, y) => x === y || editDistance(x, y) / Math.max(x.length, y.length) <= 0.12;
  const bare = (name) => nameKey(name.replace(/[([].*$/, ''));
  return close(nameKey(a), nameKey(b)) || (bare(a).length >= 4 && close(bare(a), bare(b)));
}

// A word the model made up rarely comes out the same twice, so only ingredients seen in both readings are kept.
function agreeOn(first, second) {
  const ingredients = first.ingredients.filter((a) => second.ingredients.some((b) => sameIngredient(a, b)));
  const longest = Math.max(first.ingredients.length, second.ingredients.length);
  const agreement = longest ? ingredients.length / longest : 1;
  if (agreement < 0.6) return { ...first, hasList: true, ingredients: [], legibility: 'none' };
  const complete = agreement >= 0.9 && first.legibility === 'full' && second.legibility === 'full';
  return { ...first, hasList: first.hasList || second.hasList, ingredients, legibility: complete ? 'full' : 'partial' };
}

async function readPhoto(apiKey, ctx, imageDataUrl) {
  const messagesFor = (model) => [
    { role: 'system', content: PHOTO_PROMPT },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: imageDataUrl, detail: model.startsWith('gpt-5.4') ? 'original' : 'high' } }],
    },
  ];
  const read = async () => parsePhoto(await askAI(apiKey, ctx, messagesFor, { maxTokens: 4000, models: PHOTO_MODELS }));
  const [first, second] = await Promise.allSettled([read(), read()]);
  if (first.status === 'rejected' && second.status === 'rejected') throw first.reason;
  if (first.status === 'rejected') return second.value;
  if (second.status === 'rejected') return first.value;
  return { ...agreeOn(first.value, second.value), turn: first.value.turn || second.value.turn };
}

async function findProduct(apiKey, ctx, name) {
  const product = await lookupProduct(name);
  if (product && product.ingredients.length > 2) return { ingredients: product.ingredients, productName: product.name, source: 'product' };
  const found = await searchProductIngredients(apiKey, ctx, name);
  if (found && found.length > 2) return { ingredients: found, productName: name, source: 'web' };
  return null;
}

async function decodePhoto(apiKey, ctx, imageDataUrl, timesTurned) {
  const photo = await readPhoto(apiKey, ctx, imageDataUrl);
  // The model misreads sideways text, so the page turns the photo upright and sends it again.
  if (photo.turn && photo.hasList && timesTurned < 2) return json({ turn: photo.turn });
  const complete = photo.legibility === 'full' && photo.ingredients.length > 0;
  if (complete || photo.ingredients.length >= 5) {
    return breakdownResponse(apiKey, ctx, {
      ingredients: photo.ingredients, productName: '', source: 'photo',
      note: complete ? '' : 'part of this label was hard to read, so some ingredients may be missing. a closer photo will show the rest.',
    });
  }

  // No readable list, so this is usually the front of a product. A brand alone is too vague to look up.
  // A list that is there but unreadable needs a closer photo, not a lookalike product.
  if (!photo.hasList && photo.brand && photo.product) {
    const name = photo.product.toLowerCase().includes(photo.brand.toLowerCase()) ? photo.product : `${photo.brand} ${photo.product}`;
    const product = await findProduct(apiKey, ctx, name);
    if (product) return breakdownResponse(apiKey, ctx, product);
    return json({ error: `this looks like ${name}, but i can't see its ingredient list. try a photo of the back, where the ingredients are printed.` }, 422);
  }
  return json({ error: "i couldn't read an ingredient list in this photo. hold the camera closer, keep it steady, and fill the frame with the list." }, 422);
}

async function explainSingleIngredient(apiKey, ctx, text) {
  const parsed = await askAI(apiKey, ctx, [
    { role: 'system', content: INGREDIENT_PROMPT },
    { role: 'user', content: text },
  ], { models: [MODEL, FALLBACK_MODEL] });
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
    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=12&fields=product_name,brands,ingredients_text`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    const queryText = query.toLowerCase();
    // A variant the visitor did not type (an SPF version, a size or number) is a different formula.
    const candidates = (data.products || [])
      .filter((product) => product.ingredients_text && product.ingredients_text.trim())
      .map((product) => {
        const name = [product.brands, product.product_name].filter(Boolean).join(' ').toLowerCase();
        const extra = name.split(/[\s,/()-]+/).filter((token) => token && !queryText.includes(token));
        return { product, name, extra };
      })
      .filter(({ name, extra }) => words.every((word) => name.includes(word))
        && !extra.some((token) => /spf|^\d/.test(token)));
    candidates.sort((a, b) => a.extra.length - b.extra.length);
    const match = candidates[0] && candidates[0].product;
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
        return parsed.ingredients.map(cleanIngredientName).filter(Boolean).slice(0, MAX_INGREDIENTS);
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

async function webSearchIngredients(apiKey, ctx, query) {
  const left = timeLeft(ctx) - 25000;
  if (left < 8000) return null;
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
      signal: AbortSignal.timeout(Math.min(30000, left)),
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

async function extractIngredientsFromName(apiKey, ctx, productName) {
  const parsed = await askAI(apiKey, ctx, [
    { role: 'system', content: NAME_INGREDIENTS_PROMPT },
    { role: 'user', content: productName },
  ], { models: [MODEL, FALLBACK_MODEL] });
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

async function searchProductIngredients(apiKey, ctx, productName) {
  const result = await webSearchIngredients(apiKey, ctx,
    `Search the web for the full ingredient list (INCI list) of "${productName}". List every ingredient as printed on the product packaging or on a retailer or review site. Format: {"found": true, "ingredients": ["Water", "Glycerin", ...]} or {"found": false}. Do not make up ingredients.`
  );
  if (result) return result;
  const simple = simplifyProductName(productName);
  if (simple && simple.toLowerCase() !== productName.toLowerCase()) {
    return await webSearchIngredients(apiKey, ctx,
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

async function breakdownResponse(apiKey, ctx, { ingredients, productName, source, note }) {
  const meta = { mode: 'list', source, productName, ingredientCount: ingredients.length, caveat: CAVEAT };

  if (!apiKey) {
    const sample = sampleBreakdown(ingredients);
    sample.worth_knowing = labelNotes(ingredients);
    return json({ demo: true, ...meta, ...sample });
  }

  const raw = await requestBreakdown(apiKey, ctx, ingredients, productName);
  let breakdown = cleanBreakdown(raw);

  const missingFrom = (groups) => {
    const covered = new Set(groups.flatMap((group) => group.ingredients.map(nameKey)));
    return ingredients.filter((name) => !covered.has(nameKey(name)));
  };
  const missing = missingFrom(breakdown.groups);
  if (missing.length > 0 && missing.length < ingredients.length && timeLeft(ctx) > 20000) {
    try {
      const retry = await requestBreakdown(apiKey, ctx, missing, productName, [MODEL, FALLBACK_MODEL]);
      raw.groups.push(...retry.groups);
      breakdown = cleanBreakdown(raw);
    } catch {}
  }

  if (breakdown.groups.length === 0) {
    breakdown = cleanBreakdown(await requestBreakdown(apiKey, ctx, ingredients, productName, [FALLBACK_MODEL]));
    if (breakdown.groups.length === 0) throw new Error('empty');
  }
  const leftOver = missingFrom(breakdown.groups);
  if (leftOver.length > 0) {
    breakdown.groups.push({ label: 'also in there', ingredients: leftOver, explanation: "i'm not sure about these." });
  }
  breakdown.worth_knowing = tidyNotes(breakdown.worth_knowing, ingredients);
  // With part of the list unread, "no parabens in this list" could be wrong.
  breakdown.worth_knowing.push(...(note ? [] : labelNotes(ingredients)));
  if (note) breakdown.worth_knowing.unshift(note);
  return json({ demo: false, ...meta, ...breakdown });
}

async function identifyProduct(apiKey, ctx, text) {
  const parsed = await askAI(apiKey, ctx, [
    { role: 'system', content: PRODUCT_PROMPT },
    { role: 'user', content: text },
  ], { models: [FALLBACK_MODEL, MODEL] });
  return {
    brand: String(parsed.brand || '').trim().slice(0, 60),
    name: String(parsed.name || '').trim().slice(0, 120),
  };
}

function isBrandOnly(text, brand) {
  const typed = nameKey(text);
  const known = nameKey(brand);
  if (!typed || !known) return false;
  return typed === known || editDistance(typed, known) / Math.max(typed.length, known.length) <= 0.2;
}

async function tryIngredient(apiKey, ctx, text) {
  const single = await explainSingleIngredient(apiKey, ctx, text);
  if (!single) return null;
  // "vitamin c serum" contains an ingredient but is a product, so a longer search must be the ingredient's whole name.
  if (/\s/.test(text) && !sameIngredient(single.name, text)) return null;
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
  const ctx = { deadline: Date.now() + REQUEST_BUDGET_MS };
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

  let text = typeof payload.text === 'string' ? payload.text.trim() : '';
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
      return await decodePhoto(apiKey, ctx, image, Number(payload.turned) || 0);
    }

    if (looksLikeList(text)) {
      return await breakdownResponse(apiKey, ctx, { ingredients: splitIngredients(text), productName: '', source: 'list' });
    }
    text = stripSize(text) || text;

    // The product list matches any product containing these words, so an ingredient or a brand on its own has to be caught first.
    const short = apiKey && text.split(/\s+/).length <= 4;
    const [product, ingredient, early] = await Promise.all([
      lookupProduct(text),
      short ? tryIngredient(apiKey, ctx, text).catch(() => null) : null,
      short ? identifyProduct(apiKey, ctx, text).catch(() => null) : null,
    ]);
    const brandTyped = early && early.brand && nameKey(text).includes(nameKey(early.brand));
    if (ingredient && !brandTyped) return ingredient;
    if (early && isBrandOnly(text, early.brand)) {
      return json({ error: `i can see this is a ${early.brand} product. please type the full product name, or upload a photo of the ingredient list.` }, 404);
    }
    if (product && product.ingredients.length > 0) {
      return await breakdownResponse(apiKey, ctx, { ingredients: product.ingredients, productName: product.name, source: 'product' });
    }

    if (!apiKey) {
      return json({ demo: true, mode: 'ingredient', caveat: CAVEAT, intro: '', groups: [{ label: text, ingredients: [text], explanation: 'placeholder text for this ingredient. the real explanation appears once the key is connected.' }], worth_knowing: [] });
    }

    let info = { brand: '', name: '' };
    let webDirect = null;
    const [identified, searched] = await Promise.allSettled([
      early || identifyProduct(apiKey, ctx, text),
      searchProductIngredients(apiKey, ctx, text),
    ]);
    if (identified.status === 'fulfilled') info = identified.value;
    if (searched.status === 'fulfilled') webDirect = searched.value;
    if (webDirect && webDirect.length > 0) {
      return await breakdownResponse(apiKey, ctx, { ingredients: webDirect, productName: info.name || text, source: 'web' });
    }

    if (info.name) {
      const corrected = await lookupProduct(info.name);
      const brandWord = info.brand.toLowerCase().split(/\s+/)[0] || '';
      const brandMatches = !brandWord || corrected?.name.toLowerCase().includes(brandWord);
      if (corrected && brandMatches && corrected.ingredients.length > 0) {
        return await breakdownResponse(apiKey, ctx, { ingredients: corrected.ingredients, productName: corrected.name, source: 'product' });
      }
      if (simplifyProductName(info.name).toLowerCase() !== simplifyProductName(text).toLowerCase()) {
        const webCorrected = await searchProductIngredients(apiKey, ctx, info.name);
        if (webCorrected && webCorrected.length > 0) {
          return await breakdownResponse(apiKey, ctx, { ingredients: webCorrected, productName: info.name, source: 'web' });
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
        const nameIngredients = await extractIngredientsFromName(apiKey, ctx, info.name || text);
        if (nameIngredients && nameIngredients.length > 0) {
          return await breakdownResponse(apiKey, ctx, { ingredients: nameIngredients, productName: info.name || text, source: 'name' });
        }
      } catch {}
    }

    return json({ error: NOT_FOUND }, 404);
  } catch (err) {
    console.error('decode failed:', err.message);
    return json({ error: 'that one took longer than usual. please press decode again.' }, 502);
  }
}
