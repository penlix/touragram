import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripDataUrlPrefix,
  buildLocationHint,
  extractLandmarks,
  extractImageInfos,
  isUsablePhoto,
  classifyPhoto,
  filenameFromUrl,
  filterGalleryImages,
  extractLeadImageUrl,
  combinePhotos
} from './identify-logic.js';

// --- stripDataUrlPrefix ---------------------------------------------------

test('stripDataUrlPrefix removes a jpeg data-URL prefix', () => {
  assert.equal(stripDataUrlPrefix('data:image/jpeg;base64,ABC123'), 'ABC123');
});

test('stripDataUrlPrefix removes a png data-URL prefix', () => {
  assert.equal(stripDataUrlPrefix('data:image/png;base64,ABC123'), 'ABC123');
});

test('stripDataUrlPrefix leaves a string with no prefix unchanged', () => {
  assert.equal(stripDataUrlPrefix('ABC123'), 'ABC123');
});

test('stripDataUrlPrefix only strips the leading prefix, not later text', () => {
  // The base64 body should never contain the prefix, but if it somehow did,
  // only the anchored leading match is removed.
  assert.equal(
    stripDataUrlPrefix('data:image/jpeg;base64,Xdata:image/jpeg;base64,Y'),
    'Xdata:image/jpeg;base64,Y'
  );
});

// --- buildLocationHint ----------------------------------------------------

test('buildLocationHint includes both coordinates when present', () => {
  const hint = buildLocationHint(52.52, 13.40);
  assert.match(hint, /52\.52/);
  assert.match(hint, /13\.4/);
  assert.match(hint, /strong hint/);
});

test('buildLocationHint reports no data when lat is null', () => {
  assert.equal(buildLocationHint(null, 13.40), 'No location data is available.');
});

test('buildLocationHint reports no data when lng is null', () => {
  assert.equal(buildLocationHint(52.52, null), 'No location data is available.');
});

test('buildLocationHint reports no data when both are null', () => {
  assert.equal(buildLocationHint(null, null), 'No location data is available.');
});

test('buildLocationHint treats 0,0 as a real location (not falsy-dropped)', () => {
  const hint = buildLocationHint(0, 0);
  assert.match(hint, /latitude 0, longitude 0/);
});

// --- extractLandmarks -----------------------------------------------------

test('extractLandmarks returns the landmarks from a tool_use block', () => {
  const message = {
    content: [
      { type: 'tool_use', input: { landmarks: [{ name: 'A' }, { name: 'B' }] } }
    ]
  };
  assert.deepEqual(extractLandmarks(message), [{ name: 'A' }, { name: 'B' }]);
});

test('extractLandmarks finds the tool_use block even after a text block', () => {
  const message = {
    content: [
      { type: 'text', text: 'thinking...' },
      { type: 'tool_use', input: { landmarks: [{ name: 'A' }] } }
    ]
  };
  assert.deepEqual(extractLandmarks(message), [{ name: 'A' }]);
});

test('extractLandmarks returns an empty array when the model found nothing', () => {
  const message = {
    content: [{ type: 'tool_use', input: { landmarks: [] } }]
  };
  assert.deepEqual(extractLandmarks(message), []);
});

test('extractLandmarks throws when there is no tool_use block', () => {
  const message = { content: [{ type: 'text', text: 'no tool here' }] };
  assert.throws(() => extractLandmarks(message), /tool_use/);
});

test('extractLandmarks throws when landmarks is not an array', () => {
  const message = {
    content: [{ type: 'tool_use', input: { landmarks: 'oops' } }]
  };
  assert.throws(() => extractLandmarks(message), /landmarks array/);
});

// --- extractImageInfos ----------------------------------------------------

test('extractImageInfos pulls the first imageinfo from each page', () => {
  const response = {
    query: {
      pages: {
        '-1': { imageinfo: [{ url: 'a.jpg' }] },
        '-2': { imageinfo: [{ url: 'b.png' }] }
      }
    }
  };
  assert.deepEqual(extractImageInfos(response), [{ url: 'a.jpg' }, { url: 'b.png' }]);
});

test('extractImageInfos returns [] when query is missing', () => {
  assert.deepEqual(extractImageInfos({}), []);
});

test('extractImageInfos returns [] when pages is missing', () => {
  assert.deepEqual(extractImageInfos({ query: {} }), []);
});

test('extractImageInfos drops pages with no imageinfo', () => {
  const response = {
    query: {
      pages: {
        '-1': { imageinfo: [{ url: 'a.jpg' }] },
        '-2': { title: 'File:NoInfo.jpg' }
      }
    }
  };
  assert.deepEqual(extractImageInfos(response), [{ url: 'a.jpg' }]);
});

// --- isUsablePhoto --------------------------------------------------------

test('isUsablePhoto keeps a large jpeg', () => {
  assert.equal(isUsablePhoto({ mime: 'image/jpeg', width: 1200, url: 'tower.jpg' }), true);
});

test('isUsablePhoto keeps a large png', () => {
  assert.equal(isUsablePhoto({ mime: 'image/png', width: 800, url: 'gate.png' }), true);
});

test('isUsablePhoto keeps an image exactly at the 400px boundary', () => {
  assert.equal(isUsablePhoto({ mime: 'image/jpeg', width: 400, url: 'x.jpg' }), true);
});

test('isUsablePhoto drops an image just under 400px', () => {
  assert.equal(isUsablePhoto({ mime: 'image/jpeg', width: 399, url: 'x.jpg' }), false);
});

test('isUsablePhoto drops an SVG even when large', () => {
  assert.equal(isUsablePhoto({ mime: 'image/svg+xml', width: 2000, url: 'map.svg' }), false);
});

test('isUsablePhoto drops a gif', () => {
  assert.equal(isUsablePhoto({ mime: 'image/gif', width: 800, url: 'anim.gif' }), false);
});

test('isUsablePhoto drops blocklisted chrome filenames in realistic full URLs (case-insensitive)', () => {
  const base = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/';
  assert.equal(isUsablePhoto({ mime: 'image/png', width: 500, url: base + 'Commons-logo.png' }), false);
  assert.equal(isUsablePhoto({ mime: 'image/png', width: 500, url: base + 'Flag_of_Germany.png' }), false);
  assert.equal(isUsablePhoto({ mime: 'image/png', width: 500, url: base + 'WIKIDATA-icon.png' }), false);
  assert.equal(isUsablePhoto({ mime: 'image/png', width: 500, url: base + 'OOjs_UI_edit.png' }), false);
});

// Regression: the exact bug we hit — a real photo on upload.wikimedia.org was
// rejected because the blocklist matched "wikimedia" in the host. The blocklist
// now tests the filename only, so the domain no longer triggers it.
test('isUsablePhoto keeps a real photo on upload.wikimedia.org (host no longer triggers blocklist)', () => {
  assert.equal(isUsablePhoto({
    mime: 'image/jpeg',
    width: 3686,
    url: 'https://upload.wikimedia.org/wikipedia/commons/3/30/1000_Eiffel_tower_night_illumination_by_Giles_Laurent.jpg'
  }), true);
});

test('isUsablePhoto drops an info with missing width', () => {
  assert.equal(isUsablePhoto({ mime: 'image/jpeg', url: 'x.jpg' }), false);
});

test('isUsablePhoto drops an info with missing mime', () => {
  assert.equal(isUsablePhoto({ width: 800, url: 'x.jpg' }), false);
});

test('isUsablePhoto drops null/undefined safely', () => {
  assert.equal(isUsablePhoto(null), false);
  assert.equal(isUsablePhoto(undefined), false);
});

// --- filenameFromUrl ------------------------------------------------------

test('filenameFromUrl returns the last path segment', () => {
  assert.equal(
    filenameFromUrl('https://upload.wikimedia.org/wikipedia/commons/3/30/Eiffel.jpg'),
    'Eiffel.jpg'
  );
});

test('filenameFromUrl returns a bare filename unchanged', () => {
  assert.equal(filenameFromUrl('Eiffel.jpg'), 'Eiffel.jpg');
});

test('filenameFromUrl returns empty string for null/undefined', () => {
  assert.equal(filenameFromUrl(null), '');
  assert.equal(filenameFromUrl(undefined), '');
});

// --- classifyPhoto --------------------------------------------------------

test('classifyPhoto returns ok for a usable photo with a thumburl', () => {
  assert.equal(classifyPhoto({ mime: 'image/jpeg', width: 800, url: 'tower.jpg', thumburl: 't.jpg' }), 'ok');
});

test('classifyPhoto reports mime for a non-jpeg/png', () => {
  assert.equal(classifyPhoto({ mime: 'image/svg+xml', width: 800, url: 'm.svg', thumburl: 't.svg' }), 'mime');
});

test('classifyPhoto reports width for a small image', () => {
  assert.equal(classifyPhoto({ mime: 'image/jpeg', width: 100, url: 'x.jpg', thumburl: 't.jpg' }), 'width');
});

test('classifyPhoto reports blocklist for chrome filenames in a full URL', () => {
  assert.equal(classifyPhoto({
    mime: 'image/png', width: 800,
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Commons-logo.png',
    thumburl: 't.png'
  }), 'blocklist');
});

test('classifyPhoto returns ok for a real wikimedia-hosted photo', () => {
  assert.equal(classifyPhoto({
    mime: 'image/jpeg', width: 3686,
    url: 'https://upload.wikimedia.org/wikipedia/commons/3/30/1000_Eiffel_tower_night.jpg',
    thumburl: 't.jpg'
  }), 'ok');
});

test('classifyPhoto reports no-thumburl for a usable photo missing its thumb', () => {
  assert.equal(classifyPhoto({ mime: 'image/jpeg', width: 800, url: 'ok.jpg' }), 'no-thumburl');
});

test('classifyPhoto reports empty for null', () => {
  assert.equal(classifyPhoto(null), 'empty');
});

// --- filterGalleryImages --------------------------------------------------

test('filterGalleryImages keeps usable photos mapped to their thumburl', () => {
  const infos = [
    { mime: 'image/jpeg', width: 1200, url: 'a.jpg', thumburl: 'a-400.jpg' },
    { mime: 'image/svg+xml', width: 2000, url: 'logo.svg', thumburl: 'logo-400.svg' },
    { mime: 'image/png', width: 800, url: 'b.png', thumburl: 'b-400.png' }
  ];
  assert.deepEqual(filterGalleryImages(infos), ['a-400.jpg', 'b-400.png']);
});

test('filterGalleryImages drops a usable photo that has no thumburl', () => {
  const infos = [
    { mime: 'image/jpeg', width: 1200, url: 'a.jpg' }, // no thumburl
    { mime: 'image/jpeg', width: 1200, url: 'b.jpg', thumburl: 'b-400.jpg' }
  ];
  assert.deepEqual(filterGalleryImages(infos), ['b-400.jpg']);
});

test('filterGalleryImages returns [] for empty input', () => {
  assert.deepEqual(filterGalleryImages([]), []);
});

// --- extractLeadImageUrl --------------------------------------------------

test('extractLeadImageUrl returns the thumbnail source', () => {
  const response = {
    query: { pages: { '123': { thumbnail: { source: 'lead-400.jpg' } } } }
  };
  assert.equal(extractLeadImageUrl(response), 'lead-400.jpg');
});

test('extractLeadImageUrl returns null when there is no thumbnail', () => {
  const response = { query: { pages: { '123': { title: 'Foo' } } } };
  assert.equal(extractLeadImageUrl(response), null);
});

test('extractLeadImageUrl returns null when the shape is missing', () => {
  assert.equal(extractLeadImageUrl({}), null);
});

// --- combinePhotos --------------------------------------------------------

test('combinePhotos puts the lead first, then the gallery', () => {
  assert.deepEqual(combinePhotos('lead.jpg', ['a.jpg', 'b.jpg']), ['lead.jpg', 'a.jpg', 'b.jpg']);
});

test('combinePhotos removes a gallery duplicate of the lead', () => {
  assert.deepEqual(combinePhotos('lead.jpg', ['lead.jpg', 'a.jpg']), ['lead.jpg', 'a.jpg']);
});

test('combinePhotos removes duplicates within the gallery', () => {
  assert.deepEqual(combinePhotos(null, ['a.jpg', 'a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg']);
});

test('combinePhotos caps the result at 6', () => {
  const gallery = ['1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(combinePhotos('lead', gallery), ['lead', '1', '2', '3', '4', '5']);
});

test('combinePhotos with a null lead returns the gallery only', () => {
  assert.deepEqual(combinePhotos(null, ['a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg']);
});

test('combinePhotos with a lead and empty gallery returns just the lead', () => {
  assert.deepEqual(combinePhotos('lead.jpg', []), ['lead.jpg']);
});

test('combinePhotos with null lead and empty gallery returns []', () => {
  assert.deepEqual(combinePhotos(null, []), []);
});
