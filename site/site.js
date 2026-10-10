// The page's two calls to clod.farm/api: the "get your own farm" form, and cookieless stats (a view, and a few clicks).
// CloudFront signs them for the Lambda behind it, which needs the SHA-256 of each body in x-amz-content-sha256.
(() => {
  const post = async (path, data, keepalive = false) => {
    const body = JSON.stringify(data);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    return fetch(path, {
      method: "POST", body, keepalive, credentials: "omit",
      headers: {
        "content-type": "application/json",
        "x-amz-content-sha256": [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      },
    });
  };

  // stats: no cookies, no storage; skipped for Global Privacy Control / Do Not Track
  const track = !(navigator.globalPrivacyControl || navigator.doNotTrack === "1") && window.crypto && crypto.subtle;
  const hit = (e, extra) => { if (track) post("/api/hit", { e, ...extra }, true).catch(() => {}); };
  hit("view", { p: location.pathname, r: document.referrer });
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-event]");
    if (el) hit(el.dataset.event);
  });

  // the form
  const form = document.getElementById("farm-form");
  if (!form) return;
  const status = document.getElementById("farm-status");
  const button = form.querySelector("button[type=submit]");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    status.className = "farm-status";
    status.textContent = "Sending...";
    try {
      const r = await post("/api/farm-request", data);
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "Something went wrong. Please try again.");
      form.hidden = true;
      status.className = "farm-status ok";
      status.textContent = `Thanks! We'll set up your farm and write to ${data.email.trim()} soon.`;
      status.focus();
    } catch (e) {
      status.className = "farm-status err";
      status.textContent = e instanceof TypeError ? "Couldn't reach clod.farm. Check your connection and try again." : e.message;
      button.disabled = false;
    }
  });
})();
