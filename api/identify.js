import Anthropic from '@anthropic-ai/sdk';
import {
  stripDataUrlPrefix,
  buildLocationHint,
  extractLandmarks,
  extractImageInfos,
  filterGalleryImages,
  extractLeadImageUrl,
  combinePhotos
} from '../lib/identify-logic.js';

// Model string. Swap to 'claude-opus-4-8' if Sonnet's accuracy disappoints
// on real landmarks — this is the only line that needs to change.
const MODEL = 'claude-sonnet-4-6';

// Allow the function up to 30s. A vision call producing a few paragraphs for
// up to 3 landmarks can take 8-15s, above Vercel's default 10s ceiling.
export const maxDuration = 30;

const PROMPT = `You are identifying landmarks, buildings, monuments, or notable points of interest visible in a photo taken by a tourist.

Identify up to 3 candidate landmarks visible in the image, ordered by your confidence (most likely first). Use any provided GPS coordinates as a strong disambiguation hint — if the coordinates clearly indicate a city or neighbourhood, prefer landmarks consistent with that location.

Report your findings using the report_landmarks tool. If you cannot confidently identify any landmark, report an empty list.`;

// The tool's input schema IS the data contract. The API validates the model's
// tool call against this schema before it reaches us, so there's no text to
// parse and nothing to parse wrong — no preamble, fences, or trailing prose
// can exist in a tool_use input.
const LANDMARKS_TOOL = {
  name: 'report_landmarks',
  description: 'Report the landmarks identified in the photo.',
  input_schema: {
    type: 'object',
    properties: {
      landmarks: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "The landmark's common name." },
            description: { type: 'string', description: '2 to 3 short paragraphs about the landmark — its history, significance, and what a visitor should know. Separate paragraphs with a blank line.' },
            wikipediaTitle: { type: ['string', 'null'], description: 'The exact English Wikipedia article title for this landmark (e.g. "Berliner Fernsehturm", "Brandenburg Gate"), or null if unsure. Used to look up photos, so accuracy matters more than guessing.' }
          },
          required: ['name', 'description', 'wikipediaTitle']
        }
      }
    },
    required: ['landmarks']
  }
};

// Wikimedia is keyless: open content, public API, rate-limited by IP and
// User-Agent. The User-Agent header is etiquette (Wikimedia may 403 anonymous
// scripts), not authentication.
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_HEADERS = { 'User-Agent': 'Touragram/1.0 (learning project; landmark identifier)' };

// The article's primary/infobox image — the canonical representative photo.
async function fetchLeadImage(title) {
  const url = `${WIKI_API}?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=400&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: WIKI_HEADERS });
  if (!res.ok) console.log(`Wikimedia pageimages ${res.status} for "${title}"`);
  const data = await res.json();
  return extractLeadImageUrl(data);
}

// All images on the article, filtered down to real photographs.
async function fetchGalleryImages(title) {
  const url = `${WIKI_API}?action=query&format=json&generator=images&gimlimit=20&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=400&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: WIKI_HEADERS });
  if (!res.ok) console.log(`Wikimedia generator=images ${res.status} for "${title}"`);
  const data = await res.json();
  return filterGalleryImages(extractImageInfos(data));
}

// Combine lead + gallery, dedupe, cap at 6. Never throws — any failure for
// one landmark just yields an empty list, so it can't sink the others.
async function fetchPhotos(title) {
  try {
    const [lead, gallery] = await Promise.all([
      fetchLeadImage(title).catch(() => null),
      fetchGalleryImages(title).catch(() => [])
    ]);
    return combinePhotos(lead, gallery);
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
    const base64 = stripDataUrlPrefix(image);

    const locationHint = buildLocationHint(lat, lng);

    // The SDK reads process.env.ANTHROPIC_API_KEY automatically.
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [LANDMARKS_TOOL],
      // Force the model to call our tool — it cannot reply with free text,
      // so its only move is a tool_use block conforming to the schema.
      tool_choice: { type: 'tool', name: 'report_landmarks' },
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

    // The tool_use block's input is already a parsed object (the SDK
    // deserializes it). No JSON.parse, no fence-stripping.
    const landmarks = extractLandmarks(message);

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
