// HackerRank adapter. inject.js reports "<contest>/<slug>/<id>"; everything else is
// re-read from HackerRank's REST API. No backfill (not implemented for this site).
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const REF_RE = /^([\w-]+)\/([a-z0-9][a-z0-9-]*)\/(\d+)$/;
  const PENDING_RE = /^(processing|queued|running|compiling)/i;

  async function rest(path) {
    const r = await fetch(`/rest/contests/${path}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HackerRank request failed (${r.status}).`);
    return (await r.json()).model;
  }

  // HackerRank language ids: cpp14, java8, python3, go ... -> ids lib.js knows.
  const ALIAS = { go: 'golang', cpp: 'cpp', c: 'c' };
  const langKey = (l) => {
    const k = String(l || '').replace(/\d+$/, '');
    return ALIAS[k] || k;
  };

  async function fetchSubmission(ref) {
    const m = REF_RE.exec(ref);
    if (!m) throw new Error('invalid submission reference.');
    const [, contest, slug, id] = m;
    for (let i = 0; i < 60; i++) {
      const sub = await rest(`${contest}/challenges/${slug}/submissions/${id}`);
      if (sub && sub.status && !PENDING_RE.test(sub.status)) {
        if (!sub.code) throw new Error('could not read the code from HackerRank.');
        let ch = null;
        try {
          ch = await rest(`${contest}/challenges/${slug}`);
        } catch (_) {
          /* push still works without the details */
        }
        return {
          slug,
          lang: langKey(sub.language),
          langName: sub.language,
          code: sub.code,
          accepted: sub.status === 'Accepted',
          statusMsg: sub.status,
          question: ch && {
            title: ch.name || slug,
            difficulty: ['Easy', 'Medium', 'Hard'].includes(ch.difficulty_name) ? ch.difficulty_name : undefined,
            topics: [],
          },
        };
      }
      await sleep(1500);
    }
    throw new Error('timed out waiting for the HackerRank judge.');
  }

  globalThis.solvepushAdapter = { id: 'hackerrank', fetchSubmission };
})();
