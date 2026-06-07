// Pure logic for the landmark-identify serverless function.
//
// Everything here takes inputs and returns outputs with no network calls and
// no side effects, so it can be unit-tested in isolation. The function in
// api/identify.js imports these and keeps only the thin fetch wrappers and the
// request handler. This module imports nothing, so `node --test` runs the
// tests with zero dependencies installed.

// Strip the "data:image/jpeg;base64," prefix the browser's canvas produces,
// leaving the raw base64 the Anthropic API wants. Only the leading prefix is
// removed; a string with no prefix comes back unchanged.
export function stripDataUrlPrefix(dataUrl) {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

// The GPS hint sentence appended to the prompt. Uses != null so that the
// coordinate 0 (a valid location) is treated as present, not falsy-dropped.
export function buildLocationHint(lat, lng) {
  return (lat != null && lng != null)
    ? `The photo was taken near latitude ${lat}, longitude ${lng}. Use this as a strong hint.`
    : `No location data is available.`;
}

// Pull the landmarks array out of a Claude message's tool_use block. Throws on
// a missing block or a non-array payload so the handler's catch returns a 500.
export function extractLandmarks(message) {
  const toolUse = message.content.find(block => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not return a tool_use block');
  }
  const landmarks = toolUse.input.landmarks;
  if (!Array.isArray(landmarks)) {
    throw new Error('Tool input did not contain a landmarks array');
  }
  return landmarks;
}

// Pull the array of imageinfo objects out of a Wikimedia generator=images
// response. Tolerant of a missing query/pages shape and pages with no
// imageinfo — those just don't contribute.
export function extractImageInfos(wikimediaResponse) {
  const pages = wikimediaResponse?.query?.pages || {};
  return Object.values(pages)
    .map(p => p.imageinfo?.[0])
    .filter(Boolean);
}

// Filenames/URLs that are Wikipedia chrome rather than photos. Shared by
// isUsablePhoto and classifyPhoto so the two can never drift apart.
export const CHROME_PATTERN = /commons-logo|wikimedia|wikidata|edit_icon|oojs|ambox|wiki_letter|magnify|symbol|flag_of/i;

// Is this image a real photograph rather than Wikipedia chrome? Keep JPEG/PNG
// only (drops SVG icons/logos/flags/maps), require a reasonable size (drops
// small chrome), and block known chrome filenames.
export function isUsablePhoto(info) {
  return (
    !!info &&
    (info.mime === 'image/jpeg' || info.mime === 'image/png') &&
    info.width >= 400 &&
    !CHROME_PATTERN.test(info.url)
  );
}

// Diagnostic: classify a single image as 'ok' or the first check it fails.
// Mirrors the full keep condition (isUsablePhoto plus the thumburl requirement
// from filterGalleryImages) so logging reflects exactly why an image is lost.
export function classifyPhoto(info) {
  if (!info) return 'empty';
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') return 'mime';
  if (!(info.width >= 400)) return 'width';
  if (CHROME_PATTERN.test(info.url)) return 'blocklist';
  if (!info.thumburl) return 'no-thumburl';
  return 'ok';
}

// Filter imageinfo objects to usable photos and map them to their 400px
// thumbnail URLs, dropping any without one.
export function filterGalleryImages(infos) {
  return infos
    .filter(isUsablePhoto)
    .map(info => info.thumburl)
    .filter(Boolean);
}

// Pull the lead/infobox thumbnail URL out of a Wikimedia pageimages response,
// or null if there isn't one.
export function extractLeadImageUrl(wikimediaResponse) {
  const pages = wikimediaResponse?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.thumbnail?.source || null;
}

// Combine the lead image and the gallery into one list: lead first, duplicates
// removed, capped at 6. A null lead or empty gallery is fine.
export function combinePhotos(lead, gallery) {
  const urls = [];
  if (lead) urls.push(lead);
  for (const u of gallery) {
    if (!urls.includes(u) && urls.length < 6) urls.push(u);
  }
  return urls.slice(0, 6);
}
