// Page-world script: watches HackerRank's "submit" request
// (POST /rest/contests/<contest>/challenges/<slug>/submissions) and forwards
// "<contest>/<slug>/<submission id>" to the adapter. "Run code" uses a different URL and is ignored.
(() => {
  if (window.__solvepushInjected) return;
  window.__solvepushInjected = true;

  const SUBMIT_RE = /^\/rest\/contests\/([^/]+)\/challenges\/([^/]+)\/submissions\/?$/;

  function announce(url, text) {
    try {
      const m = new URL(url, location.origin).pathname.match(SUBMIT_RE);
      const id = m && JSON.parse(text)?.model?.id;
      if (!id) return;
      window.postMessage(
        { source: 'solvepush-page', type: 'submission', submissionId: `${m[1]}/${m[2]}/${id}` },
        location.origin,
      );
    } catch (_) {}
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const method = ((init && init.method) || (isReq && input.method) || 'GET').toUpperCase();
      const url = isReq ? input.url : String(input);
      if (method === 'POST')
        p.then((res) => res.clone().text())
          .then((t) => announce(url, t))
          .catch(() => {});
    } catch (_) {}
    return p;
  };

  const XO = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(method).toUpperCase() === 'POST')
      this.addEventListener('load', () => {
        try {
          announce(String(url), this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText);
        } catch (_) {}
      });
    return XO.apply(this, arguments);
  };
})();
