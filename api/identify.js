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

If you cannot confidently identify any landmark, respond with an empty array: []

Do not include any text before or after the JSON array.`;

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
        },
        // Prefill: put an opening bracket in Claude's mouth so it continues
        // straight into the JSON array with no prose preamble.
        { role: 'assistant', content: '[' }
      ]
    });

    // Glue the prefilled '[' back on, then parse.
    const raw = '[' + message.content[0].text;
    const landmarks = JSON.parse(raw);

    if (!Array.isArray(landmarks)) {
      throw new Error('Claude response was not a JSON array');
    }

    // 200 with an array (possibly empty) means a successful identification
    // attempt — empty just means "nothing confident found".
    return res.status(200).json({ landmarks });
  } catch (error) {
    // Genuine failure (SDK threw, JSON malformed, key missing). Surface a 500
    // so it shows up as a real error in the Vercel logs; the frontend treats
    // any non-ok response as the empty state.
    console.error('identify error:', error);
    return res.status(500).json({ landmarks: [], error: error.message });
  }
}
