import { GITHUB_CLIENT_ID, OAUTH_SCOPE } from './config.js';
import {
  PLATFORMS,
  platformFromOrigin,
  validSlug,
  solvedKey,
  slugsFor,
  b64,
  assertPublicOnly,
  buildFiles,
  isRetryable,
} from './lib.js';

const API = 'https://api.github.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
  remove: (keys) => chrome.storage.local.remove(keys),
};
const clientIdConfigured = () => !!GITHUB_CLIENT_ID && !GITHUB_CLIENT_ID.startsWith('YOUR_');

// Keep the token (and pending device code) out of reach of content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// ---------------------------------------------------------------- messaging
// Content scripts (one per supported platform) may only send these; everything else is popup-only.
const CONTENT_TYPES = new Set(['push', 'pushBatch', 'bf']);
const EXT_URL = chrome.runtime.getURL('');

// Who is talking? The platform comes from the sender's origin, never from the message body.
function sender(msg, s) {
  if (s.id !== chrome.runtime.id || !s.url) return null;
  if (!s.tab && s.url.startsWith(EXT_URL)) return { popup: true };
  const platform = platformFromOrigin(new URL(s.url).origin);
  return platform && CONTENT_TYPES.has(msg && msg.type) ? { platform } : null;
}

chrome.runtime.onMessage.addListener((msg, s, sendResponse) => {
  const who = sender(msg, s);
  if (!who) return;
  route(msg, who)
    .then((r) => sendResponse({ ok: true, ...(r || {}) }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true; // async response
});

async function route(msg, who) {
  switch (msg && msg.type) {
    case 'getState':
      return getState();
    case 'startDeviceFlow':
      return startDeviceFlow();
    case 'cancelDeviceFlow':
      await store.remove('deviceFlow');
      return {};
    case 'savePat':
      return savePat(msg.token);
    case 'setOptions':
      await store.set({ options: { ...(await getOptions()), ...msg.options } });
      return {};
    case 'disconnect':
      await store.remove(['token', 'user', 'repos', 'deviceFlow', 'lastPush', 'backfill', 'stats', 'pending']);
      return {};
    case 'push':
      return enqueue(() => push({ ...msg.submission, platform: who.platform }));
    case 'pushBatch':
      return enqueue(() => pushBatch((msg.submissions || []).map((s) => ({ ...s, platform: who.platform }))));
    case 'startBackfill':
      return startBackfill(msg.platform);
    case 'cancelBackfill': {
      const { backfill } = await store.get('backfill');
      if (backfill) await store.set({ backfill: { ...backfill, cancel: true } });
      return {};
    }
    case 'bf': {
      // Backfill progress lives in storage the content script can no longer touch.
      if (msg.patch) {
        const { backfill } = await store.get('backfill');
        await store.set({ backfill: { ...(backfill || {}), ...msg.patch } });
      }
      const s = await store.get(['backfill', 'stats']);
      return {
        backfill: s.backfill || {},
        solved: slugsFor(Object.keys((s.stats && s.stats.solved) || {}), who.platform),
      };
    }
    default:
      throw new Error('Unknown message');
  }
}

async function getOptions() {
  const { options } = await store.get('options');
  return { onlyAccepted: true, ...(options || {}) };
}

async function getState() {
  const s = await store.get(['user', 'repos', 'deviceFlow', 'stats', 'lastPush', 'token', 'backfill']);
  const solved = (s.stats && s.stats.solved) || {};
  const counts = { total: 0, Easy: 0, Medium: 0, Hard: 0 };
  for (const diff of Object.values(solved)) {
    counts.total++;
    if (counts[diff] !== undefined) counts[diff]++;
  }
  return {
    clientIdConfigured: clientIdConfigured(),
    connected: !!s.token,
    user: s.user || null,
    repos: Object.entries(s.repos || {}).map(([id, r]) => ({ id, platform: PLATFORMS[id]?.name || id, ...r })),
    deviceFlow: s.deviceFlow
      ? {
          userCode: s.deviceFlow.userCode,
          verificationUri: s.deviceFlow.verificationUri,
          error: s.deviceFlow.error || null,
        }
      : null,
    options: await getOptions(),
    counts,
    lastPush: s.lastPush || null,
    backfill: s.backfill || null,
    platforms: Object.entries(PLATFORMS)
      .filter(([, p]) => p.backfill)
      .map(([id, p]) => ({ id, name: p.name })),
  };
}

// ---------------------------------------------------------------- GitHub API
async function gh(path, { method = 'GET', body, token } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // GitHub sends max-age=60 on GETs; a cached ref after a recent push is stale and every retry 422s.
    cache: 'no-store',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.message) || `GitHub error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { data, headers: res.headers };
}

async function adoptToken(token) {
  const { data: user, headers } = await gh('/user', { token });
  assertPublicOnly(headers);
  await store.set({
    token,
    user: { login: user.login, avatar: user.avatar_url, url: user.html_url },
  });
  return { login: user.login };
}

// ---------------------------------------------------------------- device flow
let polling = false;

async function startDeviceFlow() {
  if (!clientIdConfigured()) throw new Error('Set GITHUB_CLIENT_ID in config.js first (see README), or use a token.');
  const r = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: OAUTH_SCOPE }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description || d.error);

  const deviceFlow = {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    interval: d.interval || 5,
    expiresAt: Date.now() + (d.expires_in || 900) * 1000,
  };
  await store.set({ deviceFlow });
  chrome.tabs.create({ url: d.verification_uri });
  pollDeviceFlow();
  return { userCode: d.user_code, verificationUri: d.verification_uri };
}

async function pollDeviceFlow() {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      // Reading storage each loop also keeps the service worker alive.
      const { deviceFlow: df } = await store.get('deviceFlow');
      if (!df || df.error) return;
      await sleep(df.interval * 1000);
      if (Date.now() > df.expiresAt) {
        await store.set({ deviceFlow: { ...df, error: 'Code expired. Try again.' } });
        return;
      }
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: df.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const d = await r.json();
      const { deviceFlow: still } = await store.get('deviceFlow');
      if (!still) return; // cancelled meanwhile

      if (d.access_token) {
        try {
          await adoptToken(d.access_token);
          await store.remove('deviceFlow');
        } catch (e) {
          await store.remove('token');
          await store.set({ deviceFlow: { ...df, error: e.message } });
        }
        return;
      }
      if (d.error === 'authorization_pending') continue;
      if (d.error === 'slow_down') {
        await store.set({ deviceFlow: { ...df, interval: d.interval || df.interval + 5 } });
        continue;
      }
      await store.set({
        deviceFlow: { ...df, error: d.error_description || d.error || 'Authorization failed.' },
      });
      return;
    }
  } finally {
    polling = false;
  }
}

// Resume polling if the service worker was restarted mid-login.
store.get('deviceFlow').then(({ deviceFlow }) => {
  if (deviceFlow && !deviceFlow.error) pollDeviceFlow();
});

async function savePat(token) {
  token = (token || '').trim();
  if (!token) throw new Error('Paste a token first.');
  return adoptToken(token);
}

// ---------------------------------------------------------------- repo setup
// One public repo per platform (e.g. leetcode-submissions), created on its first push.
// Older versions stored a single `repo`; it was always the LeetCode one.
const migrated = store.get(['repo', 'repos']).then(async ({ repo, repos }) => {
  if (repo) {
    await store.set({ repos: { leetcode: repo, ...repos } });
    await store.remove('repo');
  }
});

async function ensureRepo(platform) {
  await migrated;
  const { repos = {} } = await store.get('repos');
  return repos[platform] || setupRepo(platform);
}

async function setupRepo(platform) {
  const name = PLATFORMS[platform].repoName;
  const { token, user } = await store.get(['token', 'user']);
  if (!token || !user) throw new Error('Connect GitHub first.');

  let repo;
  try {
    // Public repos are readable with public_repo scope; a private repo with
    // this name would simply look like 404 to us and creation would fail.
    repo = (await gh(`/repos/${user.login}/${name}`, { token })).data;
    if (repo.private) throw new Error(`"${name}" is private. SolvePush only uses public repos.`);
  } catch (e) {
    if (e.status !== 404) throw e;
    try {
      repo = (
        await gh('/user/repos', {
          method: 'POST',
          token,
          body: {
            name,
            description: `My ${PLATFORMS[platform].name} submissions - auto-pushed by SolvePush`,
            private: false,
            auto_init: true,
            has_wiki: false,
            has_projects: false,
          },
        })
      ).data;
    } catch (e2) {
      if (e2.status === 422)
        throw new Error(
          `A repo named "${name}" already exists but isn't public. Rename or delete it, or make it public.`,
        );
      throw e2;
    }
  }

  const saved = {
    owner: repo.owner.login,
    name: repo.name,
    branch: repo.default_branch || 'main',
    url: repo.html_url,
  };
  const { repos = {} } = await store.get('repos');
  await store.set({ repos: { ...repos, [platform]: saved } });
  return saved;
}

// ---------------------------------------------------------------- pushing
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function commitFiles(token, repo, files, message) {
  const base = `/repos/${repo.owner}/${repo.name}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let ref;
    try {
      ref = (await gh(`${base}/git/ref/heads/${encodeURIComponent(repo.branch)}`, { token })).data;
    } catch (e) {
      if (e.status === 404 || e.status === 409) {
        // Empty repo: make a first commit so the branch exists.
        await gh(`${base}/contents/README.md`, {
          method: 'PUT',
          token,
          body: {
            message: 'Initial commit',
            content: b64(`# ${repo.name}\n\nSubmissions auto-pushed by SolvePush.\n`),
            branch: repo.branch,
          },
        });
        continue;
      }
      throw e;
    }
    const parentSha = ref.object.sha;
    const parent = (await gh(`${base}/git/commits/${parentSha}`, { token })).data;
    const tree = (
      await gh(`${base}/git/trees`, {
        method: 'POST',
        token,
        body: {
          base_tree: parent.tree.sha,
          tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
        },
      })
    ).data;
    if (tree.sha === parent.tree.sha) return { unchanged: true };

    const commit = (
      await gh(`${base}/git/commits`, {
        method: 'POST',
        token,
        body: { message, tree: tree.sha, parents: [parentSha] },
      })
    ).data;
    try {
      await gh(`${base}/git/refs/heads/${encodeURIComponent(repo.branch)}`, {
        method: 'PATCH',
        token,
        body: { sha: commit.sha, force: false },
      });
      return { commitUrl: commit.html_url };
    } catch (e) {
      if (e.status === 422) continue; // branch moved, retry on top of it
      throw e;
    }
  }
  throw new Error('Could not update the branch after several tries.');
}

async function recordSolved(subs) {
  const { stats } = await store.get('stats');
  const solved = { ...((stats && stats.solved) || {}) };
  for (const s of subs) {
    const k = solvedKey(s.platform, s.slug);
    solved[k] = (s.question && s.question.difficulty) || solved[k] || 'Unknown';
  }
  await store.set({ stats: { solved } });
}

async function pushBatch(subs) {
  subs = subs.filter((s) => s && s.code && validSlug(s.platform, s.slug));
  if (!subs.length) return { pushed: 0 };
  const { token } = await store.get('token');
  if (!token) throw new Error('Connect GitHub first.');
  const built = subs.map(buildFiles);
  const files = built.flatMap((b) => b.files);
  const message =
    `Import ${subs.length} past accepted submission${subs.length === 1 ? '' : 's'}\n\n` +
    built.map((b) => '- ' + b.title).join('\n');
  let repo, result;
  try {
    repo = await ensureRepo(subs[0].platform);
    result = await commitFiles(token, repo, files, message);
  } catch (e) {
    if (e.status === 401) await store.remove(['token']);
    throw e;
  }
  await recordSolved(subs);
  await store.set({
    lastPush: {
      ok: true,
      title: `Imported ${subs.length} past submission${subs.length === 1 ? '' : 's'}`,
      url: result.commitUrl || repo.url,
      unchanged: !!result.unchanged,
      at: Date.now(),
    },
  });
  return { pushed: subs.length };
}

async function startBackfill(platform) {
  const p = PLATFORMS[Object.hasOwn(PLATFORMS, platform) ? platform : ''];
  if (!p || !p.backfill) throw new Error('Import is not supported for this platform.');
  const { token, backfill } = await store.get(['token', 'backfill']);
  if (!token) throw new Error('Connect GitHub first.');
  if (
    backfill &&
    (backfill.status === 'running' || backfill.status === 'starting') &&
    Date.now() - (backfill.startedAt || 0) < 3 * 3600e3
  )
    throw new Error('An import is already running.');
  await store.set({ backfill: { status: 'starting', startedAt: Date.now(), platform, current: `Opening ${p.name}…` } });

  let [tab] = await chrome.tabs.query({ url: `${p.origin}/*` });
  if (tab) await chrome.tabs.update(tab.id, { active: true });
  else tab = await chrome.tabs.create({ url: p.home, active: true });

  for (let i = 0; i < 40; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'backfillRun' });
      if (r && r.ok) return {};
    } catch (_) {
      // Content script not there yet (page loading, or tab opened before the
      // extension was installed/reloaded) - reload the tab once.
      if (i === 3) await chrome.tabs.reload(tab.id);
    }
    await sleep(1000);
  }
  await store.set({
    backfill: { status: 'error', error: `Could not reach the ${p.name} tab. Open ${p.origin} and try again.` },
  });
  throw new Error(`Could not reach the ${p.name} tab.`);
}

async function push(s, { retry = false } = {}) {
  const { token } = await store.get('token');
  if (!token) return { skipped: true, reason: 'not-configured' };
  const options = await getOptions();
  const accepted = !!s.accepted;
  if (options.onlyAccepted && !accepted) return { skipped: true, reason: 'not-accepted' };
  if (!s.code) throw new Error('No code captured for this submission.');

  const { files, dir, title } = buildFiles(s);
  const message =
    `${accepted ? 'Accepted' : s.statusMsg}: ${title} [${s.langName}]` +
    (s.runtime ? ` - Runtime ${s.runtime}` : '') +
    (s.memory ? `, Memory ${s.memory}` : '');

  let repo, result;
  try {
    repo = await ensureRepo(s.platform);
    result = await commitFiles(token, repo, files, message);
  } catch (e) {
    if (e.status === 401) {
      await store.remove(['token']);
      e.message = 'GitHub access was revoked. Reconnect from the extension popup.';
    }
    if (!retry && isRetryable(e)) {
      await addPending(s);
      return { queued: true };
    }
    await store.set({ lastPush: { ok: false, title, error: e.message, at: Date.now() } });
    throw e;
  }

  const folderUrl = `${repo.url}/tree/${encodeURIComponent(repo.branch)}/${dir}`;
  if (accepted) await recordSolved([s]);
  await store.set({
    lastPush: { ok: true, title, url: result.commitUrl || folderUrl, unchanged: !!result.unchanged, at: Date.now() },
  });
  return { url: result.commitUrl || folderUrl, unchanged: !!result.unchanged };
}

// ---------------------------------------------------------------- retry queue
// Submissions that failed for a transient reason (offline, 5xx, rate limit) are
// kept in storage and retried by an alarm. Newest submission per problem wins.
const MAX_PENDING = 50;
const RETRY_ALARM = 'solvepush-retry';
const scheduleRetry = (minutes = 1) => chrome.alarms.create(RETRY_ALARM, { delayInMinutes: minutes });

async function addPending(s) {
  const { pending = [] } = await store.get('pending');
  await store.set({
    pending: [...pending.filter((p) => !(p.platform === s.platform && p.slug === s.slug)), s].slice(-MAX_PENDING),
  });
  scheduleRetry();
}

async function drainPending() {
  const { pending = [] } = await store.get('pending');
  for (const s of pending) {
    try {
      await push(s, { retry: true });
    } catch (e) {
      if (isRetryable(e)) return scheduleRetry(5); // keep the rest queued
      // anything else (bad slug, revoked token, ...) will never succeed: drop it
    }
    const cur = (await store.get('pending')).pending || [];
    await store.set({
      pending: cur.filter((p) => !(p.platform === s.platform && p.slug === s.slug && p.code === s.code)),
    });
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === RETRY_ALARM) enqueue(drainPending);
});
store.get('pending').then(({ pending }) => {
  if (pending && pending.length) scheduleRetry();
});
