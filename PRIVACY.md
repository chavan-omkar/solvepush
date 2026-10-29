# SolvePush Privacy Policy

_Last updated: 2026-10-30_

SolvePush sends your LeetCode, Codeforces and HackerRank submissions to a public GitHub repository that you own. It has no server of its own, no analytics and no ads.

## What it handles

- **Coding-site data (leetcode.com, codeforces.com, hackerrank.com):** your submitted code, language, verdict, runtime/memory, and problem title, difficulty and topics. It is read from the site you are on, using your logged-in session. The problem statement is not copied.
- **GitHub data:** your GitHub login name, avatar and profile URL, and the access token you authorize (or paste).
- **Local state:** your settings, solved counts, last-push status, import progress, and a short queue of submissions waiting to be retried.

## Where it goes

- Your code and problem metadata are sent **only to the public `<site>-submissions` repos (for example `leetcode-submissions`) on your GitHub account** (via `api.github.com`). **Those repos are public, so anyone can see what is pushed.**
- Your GitHub token is sent **only to GitHub** (`api.github.com`, `github.com/login`).
- Nothing is sent to the developer or to any third party.

## Where it is stored

Everything is stored in `chrome.storage.local` on your device. The token is not readable by the LeetCode page or by the extension's content scripts.

## Your control

- **Disconnect** in the popup deletes the token, profile, repo link, stats and retry queue.
- Uninstalling the extension deletes all local data.
- Revoke access at any time: GitHub → Settings → Applications.
- Delete pushed files by deleting them from your GitHub repo.

## Permissions

`storage` (local state), `alarms` (retry failed pushes), `leetcode.com`, `codeforces.com` and `www.hackerrank.com` (read your submissions), `github.com/login/*` and `api.github.com` (sign-in and committing).

## Contact

moderncodehead@gmail.com, or open an issue at https://github.com/chavan-omkar/solvepush/issues.
