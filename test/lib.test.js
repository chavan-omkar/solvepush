import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORMS,
  validSlug,
  solvedKey,
  slugsFor,
  platformFromOrigin,
  b64,
  assertPublicOnly,
  buildFiles,
  buildReadme,
  isRetryable,
} from '../lib.js';

const sub = (o = {}) => ({
  platform: 'leetcode',
  slug: 'two-sum',
  lang: 'python3',
  langName: 'Python3',
  statusMsg: 'Accepted',
  accepted: true,
  code: 'x',
  ...o,
});
const hdr = (v) => ({ get: () => v });

test('slug validation blocks path tricks', () => {
  for (const bad of ['../x', 'a/b', '.github', 'A', '', '-x', 'a'.repeat(101)])
    assert.ok(!validSlug('leetcode', bad), bad);
  assert.ok(validSlug('leetcode', 'two-sum'));
  assert.ok(!validSlug('nope', 'two-sum'));
  assert.ok(!validSlug('__proto__', 'two-sum'));
  assert.throws(() => buildFiles(sub({ slug: '../../.github/x' })), /Invalid/);
  assert.throws(() => buildFiles(sub({ platform: 'evil' })), /Invalid/);
});

test('platform comes from origin', () => {
  assert.equal(platformFromOrigin('https://leetcode.com'), 'leetcode');
  assert.equal(platformFromOrigin('https://leetcode.com.evil.io'), undefined);
});

test('buildFiles layout and extension fallback', () => {
  const question = { id: '1', title: 'Two Sum', difficulty: 'Easy', topics: ['Array'] };
  const { files, dir, title } = buildFiles(sub({ question }));
  assert.equal(dir, '0001-two-sum');
  assert.equal(title, '1. Two Sum');
  assert.deepEqual(
    files.map((f) => f.path),
    ['0001-two-sum/two-sum.py', '0001-two-sum/README.md'],
  );
  assert.equal(files[0].content, 'x\n');
  for (const lang of ['constructor', '__proto__', 'nope'])
    assert.match(buildFiles(sub({ lang })).files[0].path, /\.txt$/);
});

test('a second platform gets its own links and solved keys', () => {
  PLATFORMS.fake = {
    name: 'Fake',
    origin: 'https://fake.example',
    repoName: 'fake-submissions',
    slugRe: /^[A-Za-z0-9]{1,20}$/,
    problemUrl: (slug) => `https://fake.example/p/${slug}`,
  };
  try {
    const { dir, files } = buildFiles(sub({ platform: 'fake', slug: '1700A' }));
    assert.equal(dir, '1700A');
    assert.match(files[1].content, /fake\.example\/p\/1700A/);
    assert.equal(solvedKey('fake', '1700A'), 'fake:1700A');
    assert.deepEqual(slugsFor(['two-sum', 'fake:1700A'], 'fake'), ['1700A']);
    assert.deepEqual(slugsFor(['two-sum', 'fake:1700A'], 'leetcode'), ['two-sum']);
  } finally {
    delete PLATFORMS.fake;
  }
});

test('readme has no problem statement', () => {
  const md = buildReadme(sub({ question: { id: '1', title: 'T', difficulty: 'Easy', content: '<p>SECRET</p>' } }));
  assert.ok(!md.includes('SECRET'));
  assert.match(md, /leetcode\.com\/problems\/two-sum\//);
});

test('only public_repo tokens are accepted', () => {
  assert.doesNotThrow(() => assertPublicOnly(hdr('public_repo')));
  assert.throws(() => assertPublicOnly(hdr('repo, public_repo')), /"repo" scope/);
  assert.throws(() => assertPublicOnly(hdr('read:user')), /missing/);
  assert.throws(() => assertPublicOnly(hdr(null)), /classic token/);
});

test('retryable errors', () => {
  assert.ok(isRetryable(new Error('offline')));
  for (const status of [403, 429, 500, 502]) assert.ok(isRetryable(Object.assign(new Error(), { status })));
  for (const status of [401, 404, 422]) assert.ok(!isRetryable(Object.assign(new Error(), { status })));
});

test('b64 handles unicode and large input', () => {
  assert.equal(Buffer.from(b64('héllo ✓'), 'base64').toString(), 'héllo ✓');
  assert.equal(Buffer.from(b64('a'.repeat(100000)), 'base64').length, 100000);
});

test('codeforces and hackerrank entries', () => {
  for (const ok of ['1700A', '1700B1', '4A']) assert.ok(validSlug('codeforces', ok), ok);
  for (const bad of ['a1', '../1A', '1700', '1A/x']) assert.ok(!validSlug('codeforces', bad), bad);
  assert.equal(PLATFORMS.codeforces.problemUrl('1700B1'), 'https://codeforces.com/problemset/problem/1700/B1');
  const cf = buildFiles({
    platform: 'codeforces',
    slug: '1700A',
    lang: 'cpp',
    langName: 'GNU C++17',
    statusMsg: 'Accepted',
    accepted: true,
    code: 'x',
    question: { title: '1700A - Foo', topics: ['math'] },
  });
  assert.equal(cf.dir, '1700A');
  assert.equal(cf.files[0].path, '1700A/1700A.cpp');
  assert.equal(platformFromOrigin('https://www.hackerrank.com'), 'hackerrank');
  assert.equal(platformFromOrigin('https://hackerrank.com'), undefined);
});
