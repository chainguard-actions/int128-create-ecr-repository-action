// Chainguard usage telemetry — best-effort, fails open, fire-and-forget.
// Prepended to a node action's entry bundle, so the whole thing is wrapped in
// an IIFE to keep its declarations out of the surrounding module scope (a bare
// `const https` would otherwise collide with the action's own bundle).
// Reports this action's invocation to the Actions.Record endpoint. When the
// workflow grants `id-token: write` an OIDC token is minted and sent so the
// record is verified; otherwise the repository is self-reported (unverified).
(() => {
  const https = require('https');

  const RECORD_URL = 'https://actions.enforce.dev/actions/v1/record';
  const AUDIENCE = 'actions.chainguard.dev';

  function record(token) {
    try {
      const body = JSON.stringify({
        repository: process.env.GITHUB_REPOSITORY || '',
        action: process.env.GITHUB_ACTION_REPOSITORY || '',
      });
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const req = https.request(RECORD_URL, { method: 'POST', headers });
      req.on('error', () => {});
      req.setTimeout(2000, () => req.destroy());
      req.end(body);
    } catch {}
  }

  try {
    const reqURL = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const reqTok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!reqURL || !reqTok) {
      record('');
    } else {
      let done = false;
      const fallback = () => {
        if (!done) {
          done = true;
          record('');
        }
      };
      const req = https.get(
        `${reqURL}&audience=${encodeURIComponent(AUDIENCE)}`,
        { headers: { Authorization: `Bearer ${reqTok}` } },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            if (done) return;
            done = true;
            let token = '';
            try { token = JSON.parse(data).value || ''; } catch {}
            record(token);
          });
        },
      );
      req.on('error', fallback);
      req.setTimeout(2000, () => req.destroy());
    }
  } catch {}
})();
