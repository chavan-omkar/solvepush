// Platform-independent content script. Runs after a platform adapter has set
// globalThis.solvepushAdapter (see platforms/<name>/adapter.js).
// 1. Receives a submission id from the platform's inject script (a hint only - pages can be forged)
// 2. Asks the adapter to read the full submission from the platform itself
// 3. Hands it to the background worker, which commits to GitHub
(() => {
  const adapter = globalThis.solvepushAdapter;
  if (!adapter) return;
  const seen = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== 'solvepush-page' || d.type !== 'submission') return;
    if (typeof d.submissionId !== 'string' || d.submissionId.length > 100) return;
    onId(d.submissionId);
  });

  function onId(id) {
    if (seen.has(id)) return;
    seen.add(id);
    handle(id).catch((err) => toast('SolvePush: ' + err.message, 'error'));
  }

  // Sites with no request to hook (e.g. Codeforces) detect submissions themselves.
  if (adapter.watch) adapter.watch(onId);

  async function handle(submissionId) {
    const submission = await adapter.fetchSubmission(submissionId);
    const res = await send({ type: 'push', submission });

    if (!res) return;
    if (!res.ok) return toast('SolvePush: ' + res.error, 'error');
    if (res.queued) return toast('SolvePush: GitHub unreachable - will retry automatically.', 'error');
    if (res.skipped) {
      if (res.reason === 'not-configured')
        toast('SolvePush: connect GitHub from the extension popup to start pushing.', 'error');
      return; // non-accepted submissions are skipped quietly
    }
    toast(
      res.unchanged ? 'SolvePush: no changes - already on GitHub.' : 'SolvePush: pushed to GitHub ✓',
      'ok',
      res.url,
    );
  }

  // ------------------------------------------------------------ backfill
  // Imports the latest Accepted solution of every problem already solved.
  let backfillRunning = false;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg && msg.type === 'backfillRun') {
      if (!backfillRunning && adapter.solvedSlugs) {
        backfillRunning = true;
        runBackfill()
          .catch((e) => setBF({ status: 'error', error: e.message }))
          .finally(() => (backfillRunning = false));
      }
      sendResponse({ ok: true });
    }
  });

  // Progress is kept by the background worker (storage is not readable from here).
  async function getBF() {
    const r = await send({ type: 'bf' });
    return (r && r.backfill) || {};
  }
  function setBF(patch) {
    return send({ type: 'bf', patch });
  }

  async function runBackfill() {
    await setBF({
      status: 'running',
      total: 0,
      done: 0,
      pushed: 0,
      failed: [],
      current: 'Loading solved problems…',
      error: null,
      cancel: false,
    });
    const already = new Set(((await send({ type: 'bf' })) || {}).solved || []);
    const todo = (await adapter.solvedSlugs()).filter((s) => !already.has(s));
    await setBF({ total: todo.length, current: '' });

    let batch = [];
    let pushed = 0;
    const failed = [];
    const flush = async () => {
      if (!batch.length) return;
      const res = await send({ type: 'pushBatch', submissions: batch });
      if (!res || !res.ok) throw new Error((res && res.error) || 'GitHub push failed.');
      pushed += batch.length;
      batch = [];
      await setBF({ pushed });
    };

    for (let i = 0; i < todo.length; i++) {
      if ((await getBF()).cancel) {
        await flush();
        return setBF({ status: 'cancelled', current: '' });
      }
      const slug = todo[i];
      await setBF({ current: slug, done: i });
      try {
        batch.push(await adapter.latestAccepted(slug));
      } catch (_) {
        failed.push(slug);
        await setBF({ failed });
      }
      if (batch.length >= 20) await flush();
      await sleep(700); // be gentle with the platform
    }
    await flush();
    await setBF({ status: 'done', done: todo.length, current: '' });
    toast(`SolvePush: imported ${pushed} past submission${pushed === 1 ? '' : 's'} ✓`, 'ok');
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            toast('SolvePush: extension was reloaded - refresh this page.', 'error');
            return resolve(null);
          }
          resolve(res);
        });
      } catch (_) {
        toast('SolvePush: extension was reloaded - refresh this page.', 'error');
        resolve(null);
      }
    });
  }

  function toast(text, kind, url) {
    const el = document.createElement(url ? 'a' : 'div');
    el.textContent = text;
    if (url) {
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener';
    }
    Object.assign(el.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: 2147483647,
      padding: '10px 14px',
      borderRadius: '8px',
      font: '500 13px/1.4 system-ui, -apple-system, sans-serif',
      color: '#fff',
      background: kind === 'error' ? '#c62828' : '#1f883d',
      boxShadow: '0 4px 16px rgba(0,0,0,.25)',
      textDecoration: 'none',
      maxWidth: '360px',
      cursor: url ? 'pointer' : 'default',
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
})();
