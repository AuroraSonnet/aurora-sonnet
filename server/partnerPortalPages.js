/** Server-rendered Partner Portal pages (Continue + Dashboard). Data comes from partnerPortal.js only. */
import { randomBytes } from 'node:crypto'

const SITE_URL = 'https://aurorasonnet.com'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function money(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function eventDateLabel(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ''))
  if (!m) return raw ? String(raw) : '—'
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : String(raw)
}

export function sendPortalPage(res, { title, body, script = '' }) {
  const nonce = randomBytes(16).toString('base64')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; ')
  )
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Aurora Sonnet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Playfair+Display:wght@400&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${SITE_URL}">
    <span class="brand-name">Aurora Sonnet</span>
    <span class="brand-tag">Timeless Wedding Singers</span>
  </a>
</header>
<main>${body}</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>`)
}

const PAGE_CSS = `
:root{--espresso:#382E27;--espresso-deep:#2C241E;--taupe:#7A685F;--cream:#F5EBE0;--paper:#FCFAF7;--blush:#F5E6E0;--blush-soft:#F8EFEA;--rose:#C4A49B;--line:rgba(56,46,39,.12);--line-strong:rgba(56,46,39,.24)}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--cream);color:var(--espresso);font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;font-weight:300;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,p{margin:0}
a{color:inherit}
button{font:inherit;color:inherit;background:none;border:0;border-radius:0;padding:0;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent}
:focus{outline:none}
:focus-visible{outline:1px solid var(--espresso);outline-offset:3px}
.serif{font-family:'Playfair Display',Georgia,serif;font-weight:400;letter-spacing:-.005em}
.top{display:flex;justify-content:center;padding:28px 20px 26px;background:#fff;border-bottom:1px solid var(--line)}
.brand{display:flex;flex-direction:column;align-items:center;text-decoration:none}
.brand-name{font-family:'Playfair Display',Georgia,serif;font-size:1.55rem;letter-spacing:.08em;text-transform:uppercase;line-height:1.1}
.brand-tag{margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--espresso)}
main{padding:clamp(48px,8vw,96px) 20px clamp(64px,9vw,112px)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:14px 30px;border:1px solid var(--espresso);background:var(--espresso);color:var(--paper);font-size:.84rem;font-weight:400;letter-spacing:.04em;line-height:1.2;text-decoration:none;transition:background 280ms ease,opacity 280ms ease}
.btn:hover{background:var(--espresso-deep)}
.btn[disabled]{opacity:.55;cursor:default}
.btn-ghost{background:#fff;color:var(--espresso)}
.btn-ghost:hover{background:var(--blush)}
.arrow{display:inline-block;font-size:1rem;line-height:1;transition:transform 280ms ease}
.btn:hover .arrow{transform:translateX(3px)}
.textbtn{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--taupe);text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--rose);min-height:44px;padding:0 4px}
.textbtn:hover{color:var(--espresso)}
.rule{display:block;width:40px;height:1px;background:var(--rose);margin:22px auto}

/* continue */
.card{max-width:520px;margin:0 auto;padding:clamp(40px,6vw,64px) clamp(24px,6vw,56px);background:var(--paper);border:1px solid var(--line);text-align:center}
.card-title{font-size:clamp(1.9rem,4vw,2.5rem);line-height:1.15}
.card-text{margin-top:14px;font-size:.98rem;line-height:1.7;color:var(--taupe)}
.card .btn{margin-top:32px}
.msg{margin-top:18px;font-size:.88rem;line-height:1.55}
.msg a{text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--rose)}

/* dashboard */
.dash{max-width:1040px;margin:0 auto}
.dash-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:clamp(36px,5vw,56px)}
.eyebrow{font-size:.7rem;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--taupe)}
.welcome{margin-top:10px;font-size:clamp(2.1rem,4.6vw,3.4rem);line-height:1.1}
.note{margin-top:14px;font-size:.95rem;color:var(--taupe)}
.panel{background:var(--paper);border:1px solid var(--line);padding:clamp(26px,4vw,40px)}
.cap{margin:0 0 18px;font-size:.7rem;font-weight:500;letter-spacing:.16em;text-transform:uppercase}
.section{margin-top:clamp(22px,3vw,28px)}
.link{display:flex;border:1px solid var(--line-strong);background:#fff}
.link input{flex:1;min-width:0;height:54px;margin:0;padding:0 16px;border:0;border-radius:0;background:transparent;font:inherit;font-size:15px;color:var(--espresso);text-overflow:ellipsis;-webkit-appearance:none;appearance:none}
.link button{flex:none;min-width:130px;padding:0 22px;background:var(--espresso);color:var(--paper);font-size:.74rem;font-weight:400;letter-spacing:.12em;text-transform:uppercase;transition:background 240ms ease}
.link button:hover{background:var(--espresso-deep)}
.hint{margin-top:12px;font-size:.86rem;line-height:1.6;color:var(--taupe)}
.earn{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(16px,2.4vw,28px)}
.earn .panel{text-align:center;padding:clamp(28px,4vw,40px) 20px}
.amount{font-variant-numeric:lining-nums;margin-top:14px;font-size:clamp(2rem,3.6vw,2.6rem);line-height:1.1}
.earn-text{margin-top:10px;font-size:.84rem;line-height:1.5;color:var(--taupe)}
.refs{width:100%}
.ref{display:grid;grid-template-columns:1.6fr 1.1fr .9fr .9fr 1fr;gap:16px;align-items:center;padding:18px 0;border-top:1px solid var(--line);font-size:.95rem}
.ref-head{padding:0 0 12px;border-top:0;font-size:.66rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--taupe)}
.ref-couple{font-family:'Playfair Display',Georgia,serif;font-size:1.08rem}
.pill{display:inline-block;padding:5px 12px;background:var(--blush-soft);border:1px solid var(--line);font-size:.74rem;letter-spacing:.06em;line-height:1.3;white-space:nowrap}
.pill-muted{background:transparent;color:var(--taupe)}
.dim{color:var(--taupe)}
.empty{padding:26px 0 6px;border-top:1px solid var(--line);color:var(--taupe);font-size:.95rem}
.foot{display:flex;justify-content:center;margin-top:clamp(36px,5vw,52px)}

@media (max-width:760px){
  .dash-head{flex-direction:column;align-items:flex-start;gap:14px}
  .earn{grid-template-columns:1fr;gap:14px}
  .earn .panel{display:grid;grid-template-columns:1fr auto;grid-template-areas:"cap amount" "text amount";align-items:center;column-gap:16px;text-align:left;padding:22px 22px}
  .earn .cap{grid-area:cap;margin:0}
  .earn .amount{grid-area:amount;margin:0;font-size:1.9rem}
  .earn .earn-text{grid-area:text;margin-top:6px}
  .ref-head{display:none}
  .ref{grid-template-columns:1fr 1fr;gap:12px 16px;padding:20px 0}
  .ref>div::before{content:attr(data-label);display:block;margin-bottom:4px;font-size:.62rem;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--taupe)}
  .ref .ref-couple{grid-column:1/-1}
  .ref .ref-couple::before{display:none}
}
@media (max-width:420px){
  main{padding:40px 18px 64px}
  .top{padding:22px 18px 20px}
  .brand-name{font-size:1.3rem}
  .panel{padding:24px 20px}
  .link{flex-direction:column}
  .link input{flex:none;width:100%;height:52px}
  .link button{min-height:50px}
  .card{padding:40px 22px}
  .card .btn{width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`

export function renderContinuePage(res) {
  sendPortalPage(res, {
    title: 'Partner Portal',
    body: `
<section class="card">
  <h1 class="card-title serif">Partner Portal</h1>
  <span class="rule"></span>
  <button class="btn" type="button" id="go">Continue to Partner Portal <span class="arrow" aria-hidden="true">&rarr;</span></button>
  <p class="msg" id="msg" role="status" aria-live="polite" hidden></p>
</section>`,
    script: `
(function(){
  var params=new URLSearchParams(location.search);var token=params.get('token')||'';
  if(history.replaceState){history.replaceState(null,'',location.pathname);}
  var btn=document.getElementById('go'),msg=document.getElementById('msg');
  function show(html){msg.innerHTML=html;msg.hidden=false;}
  if(!token){btn.hidden=true;show('This link is incomplete. <a href="${esc(PARTNER_LOGIN_URL())}">Request a new login link</a>.');return;}
  btn.addEventListener('click',function(){
    btn.disabled=true;msg.hidden=true;
    fetch('/api/partner-portal/verify',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({token:token})})
      .then(function(r){if(r.ok){location.replace('/partner');return;}
        btn.hidden=true;show(r.status===429?'Too many attempts. Please wait a few minutes and try again.':'This login link has expired or was already used. <a href="${esc(PARTNER_LOGIN_URL())}">Request a new one</a>.');})
      .catch(function(){btn.disabled=false;show('We couldn’t reach Aurora Sonnet. Please check your connection and try again.');});
  });
})();`,
  })
}

export function renderSignedOutPage(res) {
  sendPortalPage(res, {
    title: 'Partner Portal',
    body: `
<section class="card">
  <h1 class="card-title serif">Partner Portal</h1>
  <p class="card-text">Please log in to view your referrals and commissions.</p>
  <a class="btn" href="${esc(PARTNER_LOGIN_URL())}">Partner Login <span class="arrow" aria-hidden="true">&rarr;</span></a>
</section>`,
  })
}

function referralRow(r) {
  const status = `<span class="pill${r.status === 'Not Booked' ? ' pill-muted' : ''}">${esc(r.status)}</span>`
  const commission = r.commission != null ? money(r.commission) : '<span class="dim">—</span>'
  const commissionStatus = r.commissionStatus
    ? `<span class="pill${r.commissionStatus === 'Pending' ? ' pill-muted' : ''}">${esc(r.commissionStatus)}</span>`
    : '<span class="dim">—</span>'
  return `
    <div class="ref">
      <div class="ref-couple" data-label="Couple">${esc(r.couple)}</div>
      <div data-label="Event Date">${esc(eventDateLabel(r.eventDate))}</div>
      <div data-label="Status">${status}</div>
      <div data-label="Commission">${commission}</div>
      <div data-label="Commission Status">${commissionStatus}</div>
    </div>`
}

export function renderDashboardPage(res, dash) {
  const name = dash.companyName || dash.partnerName || 'Partner'
  const e = dash.earnings
  const linkSection = dash.referralLink
    ? `
  <section class="panel">
    <h2 class="cap">Your Referral Link</h2>
    <div class="link">
      <input id="ref-link" type="text" readonly value="${esc(dash.referralLink)}" aria-label="Your referral link">
      <button type="button" id="copy">Copy Link</button>
    </div>
    <p class="hint">Share this link with couples. When they contact Aurora Sonnet through it, the referral is credited to you automatically.</p>
  </section>`
    : ''
  const rows = dash.referrals.length
    ? `<div class="ref ref-head" aria-hidden="true"><div>Couple</div><div>Event Date</div><div>Status</div><div>Commission</div><div>Commission Status</div></div>${dash.referrals.map(referralRow).join('')}`
    : '<p class="empty">No referrals yet. Share your link with couples to get started.</p>'

  sendPortalPage(res, {
    title: 'Partner Portal',
    body: `
<div class="dash">
  <div class="dash-head">
    <div>
      <p class="eyebrow">Partner Portal</p>
      <h1 class="welcome serif">Welcome, ${esc(name)}</h1>
      ${dash.active ? '' : '<p class="note">Your partnership has ended. You can still follow your remaining commissions here.</p>'}
    </div>
    <button class="textbtn" type="button" id="logout">Logout</button>
  </div>
  ${linkSection}
  <section class="earn section" aria-label="Earnings">
    <div class="panel"><h2 class="cap">Pending</h2><p class="amount serif">${money(e.pending)}</p><p class="earn-text">Booked — payable after the event and final payment</p></div>
    <div class="panel"><h2 class="cap">Earned / Payable</h2><p class="amount serif">${money(e.earned)}</p><p class="earn-text">Ready to be paid to you</p></div>
    <div class="panel"><h2 class="cap">Paid</h2><p class="amount serif">${money(e.paid)}</p><p class="earn-text">Paid to you</p></div>
  </section>
  <section class="panel section">
    <h2 class="cap">Your Referrals</h2>
    <div class="refs">${rows}</div>
  </section>
  <div class="foot">
    <a class="btn btn-ghost" href="/api/partner-portal/agreement.pdf" target="_blank" rel="noopener">View Signed Agreement</a>
  </div>
</div>`,
    script: `
(function(){
  var copy=document.getElementById('copy'),input=document.getElementById('ref-link');
  if(copy&&input){copy.addEventListener('click',function(){
    function done(){copy.textContent='Copied';setTimeout(function(){copy.textContent='Copy Link';},1800);}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(input.value).then(done,function(){input.select();document.execCommand('copy');done();});}
    else{input.select();document.execCommand('copy');done();}
  });}
  document.getElementById('logout').addEventListener('click',function(){
    fetch('/api/partner-portal/logout',{method:'POST',credentials:'same-origin'}).finally(function(){location.replace(${JSON.stringify(PARTNER_LOGIN_URL())});});
  });
})();`,
  })
}

function PARTNER_LOGIN_URL() {
  return String(process.env.PARTNER_LOGIN_URL || `${SITE_URL}/partner-login`)
}
