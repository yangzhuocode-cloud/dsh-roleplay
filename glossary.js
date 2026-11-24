import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { matchMeme } from './core.js';
import { extractMemeQuery, lookupMeme } from './vendor/memewiki/lookup.js';

function termFromRow(row) {
  if (!row) return null;
  return {
    name: row.title,
    definition: String(row.summary || row.origin || row.usage || '').trim().slice(0, 2000),
    aliases: String(row.aliases || '').split(',').map(alias => alias.trim()).filter(Boolean),
    usage: String(row.usage || '').trim().slice(0, 1200),
    source: String(row.origin || '').trim().slice(0, 500),
  };
}

function byNameOrAlias(terms, query) {
  const key = query.toLocaleLowerCase();
  return terms.find(term => term.name.toLocaleLowerCase() === key)
    ?? terms.find(term => term.aliases.some(alias => alias.toLocaleLowerCase() === key));
}

export function openGlossary(filename, onError) {
  let db;
  let count = 0;
  let signature;
  let status = 'missing';

  function close() {
    db?.close();
    db = undefined;
    count = 0;
    signature = undefined;
    status = 'missing';
  }

  function refresh() {
    try {
      const file = statSync(filename, { throwIfNoEntry: false });
      if (!file?.isFile()) {
        if (signature !== undefined) close();
        return;
      }
      const version = [file.dev, file.ino, file.size, file.mtimeMs].join(':');
      if (version === signature) return;
      close();
      signature = version;
      db = new DatabaseSync(filename, { readOnly: true });
      db.exec('PRAGMA trusted_schema = OFF');
      db.prepare('SELECT title, aliases, usage, summary, origin FROM memes LIMIT 0');
      count = db.prepare('SELECT count(*) AS count FROM memes').get().count;
      status = 'ready';
    } catch (error) {
      db?.close();
      db = undefined;
      count = 0;
      if (status !== 'error') onError(error);
      status = 'error';
    }
  }

  function communityLookup(query) {
    refresh();
    return termFromRow(lookupMeme(db, query));
  }

  function search(terms, query) {
    const text = query.trim().slice(0, 1000);
    if (!text) return null;
    const extracted = extractMemeQuery(text);
    const custom = byNameOrAlias(terms, text) ?? (extracted && byNameOrAlias(terms, extracted)) ?? matchMeme(terms, text);
    if (custom) return custom;
    const entry = communityLookup(extracted || text);
    return entry ? byNameOrAlias(terms, entry.name) ?? entry : null;
  }

  return {
    info() {
      refresh();
      return { status, count };
    },
    search,
    prefetch(terms, message) {
      const text = message.trim().slice(0, 1000);
      const custom = matchMeme(terms, text);
      if (custom) return custom;
      const query = extractMemeQuery(text);
      return query ? search(terms, query) : null;
    },
    close,
  };
}
