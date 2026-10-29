const app = document.getElementById('app');
let state = null;
let busy = false;
let flash = '';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function send(msg) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'No response' })),
  );
}

async function refresh() {
  const r = await send({ type: 'getState' });
  if (r.ok) state = r;
  render();
}

async function act(msg, after) {
  busy = true;
  flash = '';
  render();
  const r = await send(msg);
  busy = false;
  if (!r.ok) flash = r.error;
  else if (after) after(r);
  await refresh();
}

function render() {
  if (!state) return;
  const err = flash ? `<p class="err">${esc(flash)}</p>` : '';
  const dis = busy ? 'disabled' : '';

  // 1. Waiting for the user to enter the device code on GitHub
  if (state.deviceFlow) {
    const df = state.deviceFlow;
    app.innerHTML = `
      <div class="card">
        <p>Enter this code on GitHub to authorize SolvePush:</p>
        <div class="code">${esc(df.userCode)}</div>
        <div class="row">
          <button id="copy">Copy code</button>
          <a href="${esc(df.verificationUri)}" target="_blank"><button>Open GitHub</button></a>
        </div>
        ${df.error ? `<p class="err">${esc(df.error)}</p>` : '<p class="muted">Waiting for approval&hellip; public repos are created on your first submission.</p>'}
      </div>
      <button class="link" id="cancel">${df.error ? 'Start over' : 'Cancel'}</button>${err}`;
    document.getElementById('copy').onclick = () => navigator.clipboard.writeText(df.userCode);
    document.getElementById('cancel').onclick = () => act({ type: 'cancelDeviceFlow' });
    return;
  }

  // 2. Not connected
  if (!state.connected) {
    app.innerHTML = `
      <p>Connect GitHub and SolvePush will create a <b>public</b> repo for each coding site you use
      (like <code>leetcode-submissions</code>) and push your submissions to it.</p>
      ${
        state.clientIdConfigured
          ? `<button class="primary" id="connect" ${dis}>Connect GitHub</button>`
          : `<p class="muted">Add your OAuth App Client ID to <code>config.js</code> to enable one-click sign-in, or use a token below.</p>`
      }
      <details ${state.clientIdConfigured ? '' : 'open'}>
        <summary>Use a personal access token instead</summary>
        <div class="card">
          <p class="muted">Classic token with <b>only</b> the <code>public_repo</code> scope. Tokens with <code>repo</code> are rejected.</p>
          <input type="password" id="pat" placeholder="ghp_..." />
          <button id="savePat" ${dis}>Save token</button>
        </div>
      </details>${err}`;
    const c = document.getElementById('connect');
    if (c) c.onclick = () => act({ type: 'startDeviceFlow' });
    document.getElementById('savePat').onclick = () =>
      act({ type: 'savePat', token: document.getElementById('pat').value });
    return;
  }

  // 3. Ready
  const c = state.counts;
  const lp = state.lastPush;
  const ago = lp ? timeAgo(lp.at) : '';
  app.innerHTML = `
    <div class="user">
      <img src="${esc(state.user.avatar)}" alt="">
      <div><b>${esc(state.user.login)}</b><br>
      ${
        state.repos.length
          ? state.repos
              .map((r) => `<a href="${esc(r.url)}" target="_blank" class="muted">${esc(r.owner)}/${esc(r.name)}</a>`)
              .join('<br>')
          : '<span class="muted">A public repo per site is created on your first submission.</span>'
      }</div>
    </div>
    <div class="card stats">
      <div><b>${c.total}</b><span>Solved</span></div>
      <div class="easy"><b>${c.Easy}</b><span>Easy</span></div>
      <div class="medium"><b>${c.Medium}</b><span>Medium</span></div>
      <div class="hard"><b>${c.Hard}</b><span>Hard</span></div>
    </div>
    <label class="toggle"><input type="checkbox" id="onlyAcc" ${state.options.onlyAccepted ? 'checked' : ''}>
      Push only Accepted submissions</label>
    ${
      lp
        ? `<div class="card"><span class="muted">Last push &middot; ${esc(ago)}</span>
         ${
           lp.ok
             ? `<a href="${esc(lp.url)}" target="_blank">${esc(lp.title)}</a>${lp.unchanged ? ' <span class="muted">(no changes)</span>' : ''}`
             : `<span class="err">${esc(lp.title)}: ${esc(lp.error)}</span>`
         }</div>`
        : `<p class="muted">Submit a solution on a supported site and it will appear here.</p>`
    }
    ${backfillCard(state.backfill, dis, state.platforms)}
    <button class="link" id="disconnect">Disconnect</button>${err}`;
  for (const b of document.querySelectorAll('button[data-platform]'))
    b.onclick = () => act({ type: 'startBackfill', platform: b.dataset.platform });
  const cb = document.getElementById('cancelImport');
  if (cb) cb.onclick = () => act({ type: 'cancelBackfill' });
  document.getElementById('onlyAcc').onchange = (e) =>
    act({ type: 'setOptions', options: { onlyAccepted: e.target.checked } });
  document.getElementById('disconnect').onclick = () => act({ type: 'disconnect' });
}

function backfillCard(bf, dis, platforms = []) {
  const running = bf && (bf.status === 'running' || bf.status === 'starting');
  if (running) {
    const pct = bf.total ? Math.round(((bf.done || 0) / bf.total) * 100) : 0;
    return `<div class="card">
      <b>Importing past submissions&hellip;</b>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <span class="muted">${bf.total ? `${bf.done || 0} / ${bf.total} &middot; pushed ${bf.pushed || 0}` : ''}
        ${bf.current ? `<br>${esc(bf.current)}` : ''}</span>
      <span class="muted">Keep the platform tab open until it finishes.</span>
      <button id="cancelImport">Stop</button></div>`;
  }
  let note = '';
  if (bf && bf.status === 'done')
    note = `<span class="muted">Last import: ${bf.pushed || 0} pushed${bf.failed && bf.failed.length ? `, ${bf.failed.length} skipped` : ''}.</span>`;
  else if (bf && bf.status === 'cancelled')
    note = `<span class="muted">Import stopped after ${bf.pushed || 0} pushed. Run again to continue.</span>`;
  else if (bf && bf.status === 'error') note = `<span class="err">${esc(bf.error)}</span>`;
  return `<div class="card">
    <b>Already-solved problems</b>
    <span class="muted">Push the latest Accepted solution of every problem you've solved before. Problems already in the repo are skipped.</span>
    ${platforms.map((p) => `<button data-platform="${esc(p.id)}" ${dis}>Import from ${esc(p.name)}</button>`).join('')}${note}</div>`;
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

chrome.storage.onChanged.addListener(() => refresh());
refresh();
