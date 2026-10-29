// Runs in the page's own JS world so it can see LeetCode's network calls.
// It only watches the "submit" request and forwards the code + submission id
// to the extension's content script via window.postMessage.
(() => {
  if (window.__solvepushInjected) return;
  window.__solvepushInjected = true;

  const SUBMIT_RE = /^\/problems\/([^/]+)\/submit\/?$/;

  function matchSubmit(url) {
    try {
      const m = new URL(url, location.origin).pathname.match(SUBMIT_RE);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  // Only the submission id is forwarded; the content script re-reads
  // everything else from LeetCode, since page messages can be forged.
  function announce(resText) {
    try {
      const res = typeof resText === 'string' ? JSON.parse(resText) : null;
      if (!res || !res.submission_id) return;
      window.postMessage(
        { source: 'solvepush-page', type: 'submission', submissionId: String(res.submission_id) },
        location.origin,
      );
    } catch (_) {
      /* ignore malformed bodies */
    }
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let isSubmit = false;
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : String(input);
      const method = ((init && init.method) || (isReq && input.method) || 'GET').toUpperCase();
      isSubmit = method === 'POST' && !!matchSubmit(url);
    } catch (_) {}

    const p = origFetch.apply(this, arguments);
    if (isSubmit)
      p.then((res) => res.clone().text())
        .then(announce)
        .catch(() => {});
    return p;
  };

  // ---- XMLHttpRequest ----
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__solvepush = { method: String(method).toUpperCase(), url: String(url) };
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const info = this.__solvepush;
    if (info && info.method === 'POST' && matchSubmit(info.url)) {
      this.addEventListener('load', () => {
        try {
          const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
          announce(text);
        } catch (_) {}
      });
    }
    return XS.apply(this, arguments);
  };
})();
