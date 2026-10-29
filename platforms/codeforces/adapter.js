// Codeforces adapter. Uses the public API (/api/user.status) for verdicts and
// the submission page for the source code. There is no submit XHR to hook
// (Codeforces posts a normal form and redirects), so `watch` looks at the
// "my submissions" / status pages and picks up a submission made in the last 90 s.
// Gym contests (id >= 100000) are not supported.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const handle = () => {
    const a = document.querySelector('.lang-chooser a[href^="/profile/"]');
    return a && a.textContent.trim();
  };
  const slugOf = (s) => `${s.problem.contestId}${s.problem.index}`;
  const usable = (s) => Number.isInteger(s.problem.contestId) && s.problem.contestId < 100000;

  async function status(h, count) {
    const r = await fetch(`/api/user.status?handle=${encodeURIComponent(h)}&from=1&count=${count}`);
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(j.comment || 'Codeforces API error.');
    return j.result;
  }

  async function sourceOf(s) {
    const r = await fetch(`/contest/${s.problem.contestId}/submission/${s.id}`, { credentials: 'include' });
    if (!r.ok) throw new Error('could not open the submission page.');
    const pre = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('#program-source-text');
    if (!pre) throw new Error('could not read the source code from Codeforces.');
    return pre.textContent;
  }

  // First match wins, so kotlin/c++ come before java/c.
  const LANGS = [
    [/c\+\+/i, 'cpp'],
    [/kotlin/i, 'kotlin'],
    [/pypy|python/i, 'python3'],
    [/java\b|java \d/i, 'java'],
    [/javascript|node/i, 'javascript'],
    [/c#|mono/i, 'csharp'],
    [/rust/i, 'rust'],
    [/\bgo\b/i, 'golang'],
    [/ruby/i, 'ruby'],
    [/php/i, 'php'],
    [/scala/i, 'scala'],
    [/^gnu c\d|^c\d/i, 'c'],
  ];
  const langKey = (name) => (LANGS.find(([re]) => re.test(name)) || [])[1] || 'txt';
  const band = (r) => (r ? (r < 1200 ? 'Easy' : r < 1900 ? 'Medium' : 'Hard') : undefined);
  const pretty = (v) => (v === 'OK' ? 'Accepted' : v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' '));

  function toSubmission(s, code) {
    const p = s.problem;
    const slug = slugOf(s);
    return {
      slug,
      lang: langKey(s.programmingLanguage),
      langName: s.programmingLanguage,
      code,
      accepted: s.verdict === 'OK',
      statusMsg: pretty(s.verdict),
      runtime: `${s.timeConsumedMillis} ms`,
      memory: `${(s.memoryConsumedBytes / 1048576).toFixed(1)} MB`,
      question: {
        title: `${slug} - ${p.name}`,
        difficulty: band(p.rating),
        topics: [...(p.tags || []), p.rating ? `rating ${p.rating}` : null].filter(Boolean),
      },
    };
  }

  async function watch(onId) {
    if (!/(\/my|\/status)\/?$/.test(location.pathname)) return;
    const h = handle();
    if (!h) return;
    try {
      const [latest] = await status(h, 1);
      if (latest && Date.now() / 1000 - latest.creationTimeSeconds < 90) onId(String(latest.id));
    } catch (_) {}
  }

  async function fetchSubmission(id) {
    if (!/^\d+$/.test(id)) throw new Error('invalid submission id.');
    const h = handle();
    if (!h) throw new Error('sign in to Codeforces first.');
    for (let i = 0; i < 60; i++) {
      const sub = (await status(h, 10)).find((s) => String(s.id) === id);
      if (sub && sub.verdict && sub.verdict !== 'TESTING') {
        if (!usable(sub)) throw new Error('gym submissions are not supported.');
        return toSubmission(sub, await sourceOf(sub));
      }
      await sleep(2000); // the API allows 1 request / 2 s
    }
    throw new Error('timed out waiting for the Codeforces judge.');
  }

  // ---- backfill ----
  let accepted = new Map();
  async function solvedSlugs() {
    const h = handle();
    if (!h) throw new Error('Sign in to Codeforces in this tab, then try again.');
    accepted = new Map();
    for (const s of await status(h, 100000)) {
      if (s.verdict === 'OK' && usable(s) && !accepted.has(slugOf(s))) accepted.set(slugOf(s), s); // newest first
    }
    return [...accepted.keys()];
  }
  async function latestAccepted(slug) {
    const s = accepted.get(slug);
    if (!s) throw new Error('no accepted submission found');
    return toSubmission(s, await sourceOf(s));
  }

  globalThis.solvepushAdapter = { id: 'codeforces', watch, fetchSubmission, solvedSlugs, latestAccepted };
})();
