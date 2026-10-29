// Pure helpers (no chrome.* calls) so they can be unit-tested with `npm test`.

// ---------------------------------------------------------------- platforms
// Background-side registry of supported coding platforms. To add one, see
// "Adding a platform" in README.md. `origin` is also how a content script is
// recognised: the platform of a message is taken from the sender's origin,
// never from the message body.
//   repoName name of the public GitHub repo created for this platform
//   slugRe   what a safe problem slug looks like (it becomes part of a repo path)
//   backfill whether the content adapter can import past submissions
//   home     page opened for an import when no tab is open
export const PLATFORMS = {
  leetcode: {
    name: 'LeetCode',
    origin: 'https://leetcode.com',
    repoName: 'leetcode-submissions',
    slugRe: /^[a-z0-9][a-z0-9-]{0,99}$/,
    backfill: true,
    home: 'https://leetcode.com/problemset/',
    problemUrl: (slug) => `https://leetcode.com/problems/${slug}/`,
  },
  codeforces: {
    name: 'Codeforces',
    origin: 'https://codeforces.com',
    repoName: 'codeforces-submissions',
    slugRe: /^[0-9]{1,5}[A-Z][0-9]?$/, // contest id + problem index, e.g. 1700A, 1700B1
    backfill: true,
    home: 'https://codeforces.com/problemset',
    problemUrl: (slug) => {
      const [, contest, index] = slug.match(/^(\d+)(.+)$/);
      return `https://codeforces.com/problemset/problem/${contest}/${index}`;
    },
  },
  hackerrank: {
    name: 'HackerRank',
    origin: 'https://www.hackerrank.com',
    repoName: 'hackerrank-submissions',
    slugRe: /^[a-z0-9][a-z0-9-]{0,99}$/,
    backfill: false,
    problemUrl: (slug) => `https://www.hackerrank.com/challenges/${slug}/problem`,
  },
};

export const platformFromOrigin = (origin) => Object.keys(PLATFORMS).find((id) => PLATFORMS[id].origin === origin);

export const validSlug = (platform, slug) =>
  Object.hasOwn(PLATFORMS, platform) && typeof slug === 'string' && PLATFORMS[platform].slugRe.test(slug);

// Keys of stats.solved. LeetCode keys are bare slugs because they predate multi-platform support.
export const solvedKey = (platform, slug) => (platform === 'leetcode' ? slug : `${platform}:${slug}`);
export const slugsFor = (keys, platform) =>
  keys
    .filter((k) => (platform === 'leetcode' ? !k.includes(':') : k.startsWith(platform + ':')))
    .map((k) => (platform === 'leetcode' ? k : k.slice(platform.length + 1)));

// ---------------------------------------------------------------- files
export const EXT = {
  cpp: 'cpp',
  java: 'java',
  python: 'py',
  python3: 'py',
  c: 'c',
  csharp: 'cs',
  javascript: 'js',
  typescript: 'ts',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  dart: 'dart',
  golang: 'go',
  ruby: 'rb',
  scala: 'scala',
  rust: 'rs',
  racket: 'rkt',
  erlang: 'erl',
  elixir: 'ex',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  postgresql: 'sql',
  pythondata: 'py',
  bash: 'sh',
  cangjie: 'cj',
};

export function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Refuse any token that could read private repos.
export function assertPublicOnly(headers) {
  const raw = headers.get('x-oauth-scopes');
  if (raw === null)
    throw new Error('Use a classic token with only the "public_repo" scope (fine-grained tokens are not supported).');
  const scopes = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (scopes.includes('repo'))
    throw new Error(
      'This token has the "repo" scope, which can read private repos. Use a token with only "public_repo".',
    );
  if (!scopes.includes('public_repo')) throw new Error('Token is missing the "public_repo" scope.');
}

// Normalized submission (what every content adapter must produce):
//   { platform, slug, lang, langName, code, accepted, statusMsg, runtime?, memory?,
//     runtimePercentile?, memoryPercentile?, question?: { id?, title, difficulty?, topics?: string[] } }
const titleOf = (s) => {
  const q = s.question;
  return q ? (q.id ? `${q.id}. ${q.title}` : q.title) : s.slug;
};

export function buildReadme(s) {
  const q = s.question;
  const tags = q && q.topics ? q.topics.map((t) => `\`${t}\``).join(' ') : '';
  const pct = (v) => (typeof v === 'number' ? ` (beats ${v.toFixed(1)}%)` : '');
  const meta = [q && q.difficulty && `**Difficulty:** ${q.difficulty}`, tags && `**Topics:** ${tags}`].filter(Boolean);
  return [
    `# [${titleOf(s)}](${PLATFORMS[s.platform].problemUrl(s.slug)})`,
    '',
    meta.join('  \n'),
    '',
    `**Last submission:** ${s.statusMsg} · ${s.langName}` +
      (s.runtime ? ` · Runtime ${s.runtime}${pct(s.runtimePercentile)}` : '') +
      (s.memory ? ` · Memory ${s.memory}${pct(s.memoryPercentile)}` : ''),
    '',
  ].join('\n');
}

export function buildFiles(s) {
  if (!validSlug(s.platform, s.slug)) throw new Error('Invalid platform or problem slug.');
  const q = s.question;
  const id = q && q.id ? String(q.id).padStart(4, '0') : null;
  const dir = id ? `${id}-${s.slug}` : s.slug;
  const ext = (Object.hasOwn(EXT, s.lang) && EXT[s.lang]) || 'txt';
  const files = [
    { path: `${dir}/${s.slug}.${ext}`, content: s.code.endsWith('\n') ? s.code : s.code + '\n' },
    { path: `${dir}/README.md`, content: buildReadme(s) },
  ];
  return { files, dir, title: titleOf(s) };
}

// Worth retrying later: network failure (no status), server errors, rate limits.
export const isRetryable = (e) => e.status === undefined || e.status >= 500 || e.status === 403 || e.status === 429;
