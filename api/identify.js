import Anthropic from '@anthropic-ai/sdk';

// Model string. Swap to 'claude-opus-4-8' if Sonnet's accuracy disappoints
// on real landmarks — this is the only line that needs to change.
const MODEL = 'claude-sonnet-4-6';

// Allow the function up to 30s. A vision call producing a few paragraphs for
// up to 3 landmarks can take 8-15s, above Vercel's default 10s ceiling.
export const maxDuration = 30;

const PROMPT = `You are identifying landmarks, buildings, monuments, or notable points of interest visible in a photo taken by a tourist.

Identify up to 3 candidate landmarks visible in the image, ordered by your confidence (most likely first). Use any provided GPS coordinates as a strong disambiguation hint — if the coordinates clearly indicate a city or neighbourhood, prefer landmarks consistent with that location.

Respond with ONLY a JSON array, no other text. Each element must be an object with exactly these keys:
  "name": the landmark's common name (string)
  "description": 2 to 3 short paragraphs about the landmark — its history, significance, and what a visitor should know. Separate paragraphs with a blank line. (string)
  "wikipediaTitle": the exact English Wikipedia article title for this landmark if you know it (e.g. "Berliner Fernsehturm", "Brandenburg Gate"), or null if you are unsure. This is used to look up photos, so accuracy matters more than guessing. (string or null)

If you cannot confidently identify any landmark, respond with an empty array: []

Do not include any text before or after the JSON array.`;

// Wikimedia is keyless: open content, public API, rate-limited by IP and
// User-Agent. The User-Agent header is etiquette (Wikimedia may 403 anonymous
// scripts), not authentication.
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_HEADERS = { 'User-Agent': 'Touragram/1.0 (learning project; landmark identifier)' };

// The article's primary/infobox image — the canonical representative photo.
async function fetchLeadImage(title) {
  const url = `${WIKI_API}?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=400&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: WIKI_HEADERS });
  const data = await res.json();
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.thumbnail?.source || null;
}

// All images on the article, filtered down to real photographs.
async function fetchGalleryImages(title) {
  const url = `${WIKI_API}?action=query&format=json&generator=images&gimlimit=20&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=400&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: WIKI_HEADERS });
  const data = await res.json();
  const pages = data.query?.pages || {};
  return Object.values(pages)
    .map(p => p.imageinfo?.[0])
    .filter(Boolean)
    // Keep JPEG/PNG only (drops SVG icons/logos/flags/maps), require a
    // reasonable size (drops small chrome), and block known chrome filenames.
    .filter(info =>
      (info.mime === 'image/jpeg' || info.mime === 'image/png') &&
      info.width >= 400 &&
      !/commons-logo|wikimedia|wikidata|edit_icon|oojs|ambox|wiki_letter|magnify|symbol|flag_of/i.test(info.url)
    )
    .map(info => info.thumburl)
    .filter(Boolean);
}

// Combine lead + gallery, dedupe, cap at 6. Never throws — any failure for
// one landmark just yields an empty list, so it can't sink the others.
async function fetchPhotos(title) {
  try {
    const [lead, gallery] = await Promise.all([
      fetchLeadImage(title).catch(() => null),
      fetchGalleryImages(title).catch(() => [])
    ]);
    const urls = [];
    if (lead) urls.push(lead);
    for (const u of gallery) {
      if (!urls.includes(u) && urls.length < 6) urls.push(u);
    }
    return urls.slice(0, 6);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ landmarks: [] });
  }

  try {
    const { image, lat, lng } = req.body;

    if (!image) {
      return res.status(400).json({ landmarks: [] });
    }

    // The browser sends a data URL ("data:image/jpeg;base64,/9j/...").
    // The API wants only the raw base64 part, so strip the prefix.
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');

    const locationHint = (lat != null && lng != null)
      ? `The photo was taken near latitude ${lat}, longitude ${lng}. Use this as a strong hint.`
      : `No location data is available.`;

    // The SDK reads process.env.ANTHROPIC_API_KEY automatically.
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: PROMPT + '\n\n' + locationHint }
          ]
        }
      ]
    });

    // Take Claude's text, strip any markdown code fences, trim, then parse.
    // The prompt instructs "respond with only a JSON array" — that does the
    // work now that prefill is gone (Sonnet 4.6 doesn't support prefill).
    let text = message.content[0].text.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const landmarks = JSON.parse(text);

    if (!Array.isArray(landmarks)) {
      throw new Error('Claude response was not a JSON array');
    }

    // For each landmark with a known Wikipedia title, look up photos. Runs in
    // parallel; fetchPhotos never throws, so one failed lookup leaves that
    // landmark with photos: [] and the rest unaffected.
    const withPhotos = await Promise.all(
      landmarks.map(async (lm) => ({
        ...lm,
        photos: lm.wikipediaTitle ? await fetchPhotos(lm.wikipediaTitle) : []
      }))
    );

    // 200 with an array (possibly empty) means a successful identification
    // attempt — empty just means "nothing confident found".
    return res.status(200).json({ landmarks: withPhotos });
  } catch (error) {
    // Genuine failure (SDK threw, JSON malformed, key missing). Surface a 500
    // so it shows up as a real error in the Vercel logs; the frontend treats
    // any non-ok response as the empty state.
    console.error('identify error:', error);
    return res.status(500).json({ landmarks: [], error: error.message });
  }
}
