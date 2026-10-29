# SolvePush — LeetCode, Codeforces, HackerRank → GitHub (public repos only)

SolvePush keeps **one public repo per coding site** on your GitHub account: `leetcode-submissions`, `codeforces-submissions`, `hackerrank-submissions`. Each repo is created the first time you submit on that site (an existing public repo with that name is reused). After that, every submission on that site is committed there automatically.

It only ever asks GitHub for the `public_repo` scope, so it **cannot read your private repositories**. It also rejects any token that has the broader `repo` scope.

## What gets pushed

```
leetcode-submissions/
├── 0001-two-sum/
│   ├── two-sum.py        ← your submitted code
│   └── README.md         ← link to the problem, difficulty, topics, runtime/memory
├── 0146-lru-cache/
│   ├── lru-cache.java
│   └── README.md
```

Each submission is one commit, for example `Accepted: 1. Two Sum [Python3] - Runtime 0 ms, Memory 18.1 MB`. If you resubmit the same problem, the file is overwritten and the change shows up in git history. Identical code produces no commit.

By default, only **Accepted** submissions are pushed. You can switch this off in the popup to push every attempt.

## Supported sites

| Site       | Auto-push on submit                                                | Import past submissions | Repo                     |
| ---------- | ------------------------------------------------------------------ | ----------------------- | ------------------------ |
| LeetCode   | yes                                                                | yes                     | `leetcode-submissions`   |
| Codeforces | yes (picked up on the "My submissions" / status page, within 90 s) | yes                     | `codeforces-submissions` |
| HackerRank | yes                                                                | no                      | `hackerrank-submissions` |

Codeforces gym contests are not supported. GeeksforGeeks and CodeChef are not built yet.

## Adding a platform (Codeforces, HackerRank, ...)

The core never mentions LeetCode; each site is a small plug-in. For a new site `foo`:

1. **`lib.js`** - add an entry to `PLATFORMS` (`name`, `origin`, `repoName` such as `'foo-submissions'`, `slugRe`, `problemUrl(slug)`, and `backfill`/`home` if it can import history). The background worker identifies the site by the sender's origin, so a page can never push as another platform.
2. **`platforms/foo/inject.js`** (optional, runs in the page world) - detect a submission and post `{ source: 'solvepush-page', type: 'submission', submissionId }` to `window`. Skip this file if the adapter can detect submissions from the DOM instead.
3. **`platforms/foo/adapter.js`** - set `globalThis.solvepushAdapter = { id: 'foo', fetchSubmission(id), solvedSlugs?(), latestAccepted?(slug) }`. `fetchSubmission` must read everything from the site itself (never trust the page message) and return the normalized shape documented above `buildReadme` in `lib.js`.
4. **`manifest.json`** - add the origin to `host_permissions`, plus two `content_scripts` entries like the LeetCode ones (`inject.js` in `world: "MAIN"`, then `adapter.js` followed by `content-core.js`).
5. Add a test in `test/` and run `npm test && npm run lint`.

## Reliability

If GitHub is unreachable or rate-limits you, the submission is kept locally (up to 50) and retried automatically every few minutes. Disconnecting clears the queue.

## Importing problems you solved before

Click **Import past submissions** in the popup. SolvePush gets your solved problems from LeetCode. For each one, it takes your **latest Accepted** submission and pushes them in commits of 20.

- It runs inside a leetcode.com tab, using your logged-in session, so keep that tab open until it finishes. The popup shows progress and has a **Stop** button.
- Problems already in the repo are skipped. You can stop and run it again to continue where it left off.
- It pauses about 1 second between problems to avoid LeetCode's rate limits, so 300 problems takes roughly 10–15 minutes.
- If a problem has no retrievable code, for example premium problems on a non-premium account, it is skipped and counted in the summary.

## Setup (about 3 minutes)

### 1. Create a GitHub OAuth App (one-time)

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - Application name: `SolvePush`
   - Homepage URL: `https://github.com`
   - Authorization callback URL: `https://github.com`. It isn't used, but the form requires it.
3. Click **Register application**, then tick **Enable Device Flow** and save.
4. Copy the **Client ID** into `config.js`:
   ```js
   export const GITHUB_CLIENT_ID = 'Ov23li...';
   ```
   No client secret is needed. Device Flow is designed for apps that can't keep a secret.

> If you'd rather skip this step, create a **classic** personal access token with only the `public_repo` box ticked. Then paste it into the popup under _"Use a personal access token instead"_.

### 2. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

### 3. Connect

1. Click the SolvePush icon and choose **Connect GitHub**.
2. A GitHub tab opens. Enter the code shown in the popup and approve.
3. Nothing is created yet. Each site's public repo appears on your first submission there.
4. Open any problem on leetcode.com and hit **Submit**. A green toast appears with a link to the commit.

## How it works

| File                            | Role                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms/leetcode/inject.js`  | Runs in the page and watches LeetCode's `POST /problems/<slug>/submit/` call to capture the submission id.                                                                              |
| `platforms/leetcode/adapter.js` | LeetCode-specific: polls until judging finishes, then reads your code, language, title, difficulty and topics from LeetCode's own API. Nothing the page posts is trusted except the id. |
| `content-core.js`               | Platform-independent: receives the id, calls the adapter, sends the result to the background worker, shows toasts, runs imports.                                                        |
| `lib.js`                        | Platform registry and pure helpers (paths, README text, validation), covered by `npm test`.                                                                                             |
| `background.js`                 | Handles GitHub login (Device Flow) and creates each site's public repo. It commits both files in one commit using the Git Data API.                                                     |
| `popup.*`                       | Connect/disconnect, solved stats, the Accepted-only toggle, and the last push status.                                                                                                   |

## Permissions, honestly

- **Chrome:** `storage` and `alarms` (for retrying failed pushes), plus access to `leetcode.com`, `github.com/login/*` and `api.github.com`. No `tabs`, no history, no other sites.
- **GitHub:** `public_repo` only. This scope cannot see private repos. GitHub has no narrower classic scope, so note that it does allow writing to _any_ public repo you have access to. SolvePush only writes to its own `*-submissions` repos.
- Your token is stored in `chrome.storage.local` on your machine (restricted to the extension's own pages, not content scripts) and sent only to `api.github.com`.

## Troubleshooting

- **"Extension was reloaded – refresh this page"**: you reloaded the extension, so refresh the LeetCode tab.
- **"A repo named … already exists but isn't public"**: you have a private repo with that name. Rename it, or create a different public repo from the popup.
- **Nothing happens on submit**: make sure you're on `leetcode.com` (leetcode.cn isn't supported) and that the popup shows you as connected.

## License

MIT - see [LICENSE](LICENSE). Contributions welcome: open an issue or PR (run `npm test && npm run lint` first).
