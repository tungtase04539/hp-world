// node server/scripts/filter_sync.mjs [--check]
// Embeds server/data/filter/*.txt into js/shared/textfilter.js (between "// BEGIN DEFAULT LISTS" and
// "// END DEFAULT LISTS") so the browser copy filters exactly like the server. --check: exit 1 when out of date.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFilterDir, renderDefaultListsBlock } from '../src/chat/lists.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', '..', 'js', 'shared', 'textfilter.js');
const BEGIN = '// BEGIN DEFAULT LISTS';
const END = '// END DEFAULT LISTS';

// returns the source with the embedded block replaced; keeps the file's line endings (git may check out CRLF)
export function syncedSource(src, lists) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lf = src.replace(/\r\n/g, '\n');
  const a = lf.indexOf(BEGIN), b = lf.indexOf(END);
  if (a < 0 || b < a) throw new Error('markers not found in textfilter.js');
  const lineEnd = lf.indexOf('\n', a) + 1;
  const out = lf.slice(0, lineEnd) + renderDefaultListsBlock(lists) + '\n' + lf.slice(b);
  return eol === '\n' ? out : out.replace(/\n/g, '\r\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { lists, missing } = readFilterDir();
  if (missing.length) { console.error('missing list files:', missing.join(', ')); process.exit(1); }
  const src = fs.readFileSync(target, 'utf8');
  const next = syncedSource(src, lists);
  if (process.argv.includes('--check')) {
    if (next !== src) { console.error('js/shared/textfilter.js is out of date: run node server/scripts/filter_sync.mjs'); process.exit(1); }
    console.log('textfilter.js default lists are up to date');
  } else if (next !== src) {
    fs.writeFileSync(target, next);
    console.log('updated', path.relative(process.cwd(), target));
  } else console.log('already up to date');
}
