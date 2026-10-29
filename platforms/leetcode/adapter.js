// LeetCode adapter (isolated-world content script). content-core.js drives it.
// It must expose globalThis.solvepushAdapter = { id, fetchSubmission, solvedSlugs, latestAccepted }
// (the last two only if the platform is marked `backfill` in lib.js). See README "Adding a platform".
// Everything is read from LeetCode's own API: ids coming from the page are only hints.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function gql(query, variables) {
    for (let i = 0; i < 6; i++) {
      const r = await fetch('/graphql/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrftoken': csrf() },
        body: JSON.stringify({ query, variables }),
      });
      if (r.status === 429 || r.status >= 500) {
        await sleep(3000 * (i + 1));
        continue;
      }
      const j = await r.json();
      if (j.errors && !j.data) throw new Error(j.errors[0].message);
      return j.data;
    }
    throw new Error('LeetCode is rate-limiting requests. Try again in a few minutes.');
  }

  async function waitForResult(id) {
    let delay = 1000;
    for (let i = 0; i < 90; i++) {
      await sleep(delay);
      try {
        const r = await fetch(`/submissions/detail/${id}/check/`, { credentials: 'include' });
        if (r.status === 429) {
          delay = Math.min(delay * 2, 8000);
          continue;
        }
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.state === 'SUCCESS') return j;
      } catch (_) {}
    }
    return null;
  }

  async function getQuestion(slug) {
    const d = await gql(
      'query solvepushQuestion($titleSlug: String!) { question(titleSlug: $titleSlug) { questionFrontendId title difficulty topicTags { name } } }',
      { titleSlug: slug },
    );
    const q = d && d.question;
    return (
      q && {
        id: q.questionFrontendId,
        title: q.title,
        difficulty: q.difficulty,
        topics: q.topicTags.map((t) => t.name),
      }
    );
  }

  async function submissionDetails(id) {
    const d = await gql(
      `query d($submissionId: Int!) { submissionDetails(submissionId: $submissionId) {
         code statusCode runtimeDisplay runtimePercentile memoryDisplay memoryPercentile
         lang { name verboseName } question { titleSlug } } }`,
      { submissionId: Number(id) },
    );
    return d.submissionDetails;
  }

  // A just-submitted solution: wait for the judge, then read it back from LeetCode.
  async function fetchSubmission(id) {
    if (!/^\d+$/.test(id)) throw new Error('invalid submission id.');
    const result = await waitForResult(id);
    if (!result) throw new Error('timed out waiting for the LeetCode judge.');
    const det = await submissionDetails(id);
    const slug = det && det.question && det.question.titleSlug;
    if (!det || !det.code || !slug) throw new Error('could not read the submission from LeetCode.');
    let question = null;
    try {
      question = await getQuestion(slug);
    } catch (_) {
      /* push still works without the details */
    }
    const lang = result.lang || (det.lang && det.lang.name);
    return {
      slug,
      lang,
      langName: result.pretty_lang || (det.lang && det.lang.verboseName) || lang,
      code: det.code,
      accepted: result.status_code === 10,
      statusMsg: result.status_msg,
      runtime: result.status_runtime,
      memory: result.status_memory,
      runtimePercentile: result.runtime_percentile,
      memoryPercentile: result.memory_percentile,
      question,
    };
  }

  // ---- backfill ----
  async function solvedSlugs() {
    const r = await fetch('/api/problems/all/', { credentials: 'include' });
    if (!r.ok) throw new Error('Could not load your solved problems from LeetCode.');
    const j = await r.json();
    if (!j.user_name) throw new Error('Sign in to LeetCode in this tab, then try again.');
    return j.stat_status_pairs.filter((p) => p.status === 'ac').map((p) => p.stat.question__title_slug);
  }

  const LIST_QUERIES = [
    `query l($questionSlug: String!, $offset: Int!, $limit: Int!) {
       questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) {
         hasNext submissions { id statusDisplay } } }`,
    `query l($questionSlug: String!, $offset: Int!, $limit: Int!) {
       submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) {
         hasNext submissions { id statusDisplay } } }`,
  ];
  let listQueryIdx = 0;

  async function latestAcceptedId(slug) {
    for (let offset = 0; offset < 100; offset += 20) {
      let list;
      while (true) {
        try {
          const d = await gql(LIST_QUERIES[listQueryIdx], { questionSlug: slug, offset, limit: 20 });
          list = d.questionSubmissionList || d.submissionList;
          break;
        } catch (e) {
          if (listQueryIdx + 1 < LIST_QUERIES.length && /Cannot query field/i.test(e.message)) {
            listQueryIdx++;
            continue;
          }
          throw e;
        }
      }
      if (!list) return null;
      const acc = list.submissions.find((s) => s.statusDisplay === 'Accepted');
      if (acc) return acc.id;
      if (!list.hasNext) return null;
      await sleep(500);
    }
    return null;
  }

  async function latestAccepted(slug) {
    const id = await latestAcceptedId(slug);
    if (!id) throw new Error('no accepted submission found');
    const det = await submissionDetails(id);
    if (!det || !det.code) throw new Error('code not available');
    let question = null;
    try {
      question = await getQuestion(slug);
    } catch (_) {}
    return {
      slug,
      lang: det.lang && det.lang.name,
      langName: (det.lang && (det.lang.verboseName || det.lang.name)) || '',
      code: det.code,
      accepted: true,
      statusMsg: 'Accepted',
      runtime: det.runtimeDisplay,
      memory: det.memoryDisplay,
      runtimePercentile: det.runtimePercentile,
      memoryPercentile: det.memoryPercentile,
      question,
    };
  }

  globalThis.solvepushAdapter = { id: 'leetcode', fetchSubmission, solvedSlugs, latestAccepted };
})();
