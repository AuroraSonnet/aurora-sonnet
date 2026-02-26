# Embed codes for aurorasonnet.com (Hostinger)

Use **one** of the blocks below per page. Paste the **entire** code block into your Hostinger HTML/Embed element.

- **Solo artist page** → use **1. SOLO**
- **Duo page** → use **2. DUO**
- **Combined (Solo + Duo) page** → use **3. COMBINED**

All forms: no past wedding dates, “From [price]” under the experience, submit to your app, redirect to `https://aurorasonnet.com/request-a-quote-thank-you`.

---

## 1. SOLO (solo artist inquiry)

Copy from the line `<!--` below through `</script>`.

```html
<!--
  Solo inquiry form — submissions go to YOUR APP only.
-->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Playfair+Display:wght@400&display=swap" rel="stylesheet" />
<style>
  .aurora-solo-wrap { max-width: 640px; margin: 0 auto; font-family: 'Inter', system-ui, sans-serif; }
  .aurora-solo-form { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e8e6e1; }
  .aurora-solo-form label { display: block; margin-bottom: 1rem; font-size: 0.9rem; color: #333; }
  .aurora-solo-form input, .aurora-solo-form select, .aurora-solo-form textarea { display: block; width: 100%; margin-top: 0.35rem; padding: 0.6rem 0.75rem; font-size: 0.95rem; border: 1px solid #ccc; border-radius: 8px; background: #f5ebe0; box-sizing: border-box; font-family: inherit; }
  .aurora-solo-form textarea { min-height: 100px; resize: vertical; }
  .aurora-solo-form .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
  .aurora-solo-form .full-width { margin-bottom: 1rem; }
  .aurora-solo-form .pkg-fieldset { border: none; padding: 1rem 0; margin: 0 0 1rem 0; }
  .aurora-solo-form .pkg-legend { font-size: 0.9rem; color: #333; margin-bottom: 0.75rem; }
  .aurora-solo-form .pkg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
  .aurora-solo-form .pkg-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; background: #fff; transition: border-color 0.2s, box-shadow 0.2s; }
  .aurora-solo-form .pkg-card:hover { border-color: #3d3630; }
  .aurora-solo-form .pkg-card.selected { border-color: #3d3630; box-shadow: 0 0 0 2px #3d3630; }
  .aurora-solo-form .pkg-card input { margin: 0 0 0.5rem 0; width: auto; }
  .aurora-solo-form .pkg-name { font-size: 0.9rem; text-align: center; }
  .aurora-solo-form .pkg-price { font-family: 'Inter', system-ui, sans-serif; font-size: 0.8rem; font-weight: 300; color: #555; margin: 0.5rem 0 0 0; }
  .aurora-solo-form .submit-btn { display: block; width: auto; min-width: 160px; margin: 1.5rem auto 0; padding: 0.65rem 2rem; font-size: 1rem; color: #fff; background: #3d3630; border: none; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .aurora-solo-form .submit-btn:hover { background: #2d2620; }
  .aurora-solo-form .submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
  .aurora-solo-form .form-error { font-size: 0.9rem; color: #c00; margin-top: 0.75rem; display: none; }
  .aurora-thankyou { background: #fff; border-radius: 12px; padding: 3rem 2rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e8e6e1; text-align: center; display: none; }
  .aurora-thankyou.visible { display: block; }
  .aurora-thankyou h2 { font-family: 'Playfair Display', serif; font-size: 1.75rem; font-weight: 400; color: #1a1a1a; margin: 0 0 1rem 0; line-height: 1.3; }
  .aurora-thankyou p { font-family: 'Inter', system-ui, sans-serif; font-size: 1rem; font-weight: 400; color: #1a1a1a; margin: 0; line-height: 1.5; }
</style>
<div class="aurora-solo-wrap">
  <div class="aurora-solo-form" id="aurora-solo-form-container">
    <form id="aurora-solo-inquiry-form">
      <div class="form-grid">
        <label>Full Name *
          <input type="text" name="name" placeholder="e.g. Emma Walsh" required />
        </label>
        <label>Email *
          <input type="email" name="email" required />
        </label>
        <label>Phone
          <input type="tel" name="phone" />
        </label>
        <label>Wedding Date *
          <input type="date" name="weddingDate" id="aurora-solo-weddingDate" required />
        </label>
        <label>Venue / Location *
          <input type="text" name="venue" placeholder="e.g. Garden Estate Vineyard" required />
        </label>
      </div>
      <div class="full-width">
        <label>Requested Artist
          <select name="requestedArtist">
            <option value="">Select Artist</option>
            <option value="dr-stephanie-susberich">Dr. Stephanie Susberich</option>
            <option value="blake-friedman">Blake Friedman</option>
          </select>
        </label>
      </div>
      <fieldset class="pkg-fieldset">
        <legend class="pkg-legend">Experience</legend>
        <div class="pkg-grid">
          <label class="pkg-card" data-pkg="signature-aria">
            <input type="radio" name="packageId" value="signature-aria" />
            <span class="pkg-name">Signature Aria</span>
          </label>
          <label class="pkg-card" data-pkg="aria-plus">
            <input type="radio" name="packageId" value="aria-plus" />
            <span class="pkg-name">Aria +</span>
          </label>
          <label class="pkg-card" data-pkg="grand-atelier">
            <input type="radio" name="packageId" value="grand-atelier" />
            <span class="pkg-name">Grand Atelier</span>
          </label>
        </div>
        <p id="aurora-solo-price" class="pkg-price" aria-live="polite"></p>
      </fieldset>
      <div class="full-width">
        <label>Message
          <textarea name="message" placeholder="Tell us about your wedding or any questions you may have." rows="3"></textarea>
        </label>
      </div>
      <p id="aurora-solo-error" class="form-error" role="alert"></p>
      <button type="submit" class="submit-btn" id="aurora-solo-submit">Send Inquiry</button>
    </form>
  </div>
  <div class="aurora-thankyou" id="aurora-solo-thankyou">
    <h2>Thank you — we've received your request</h2>
    <p>Our team is reviewing your request now and will reach out in a few moments with next steps.</p>
  </div>
</div>
<script>
(function() {
  var YOUR_APP_URL = 'https://aurora-sonnet.onrender.com';
  var THANK_YOU_URL = 'https://aurorasonnet.com/request-a-quote-thank-you';

  var form = document.getElementById('aurora-solo-inquiry-form');
  var errorEl = document.getElementById('aurora-solo-error');
  var submitBtn = document.getElementById('aurora-solo-submit');
  var priceEl = document.getElementById('aurora-solo-price');
  var weddingDateInput = document.getElementById('aurora-solo-weddingDate');

  var SOLO_PRICES = { 'signature-aria': 2750, 'aria-plus': 3950, 'grand-atelier': 5800 };
  function formatPrice(n) { return '$' + n.toLocaleString(); }
  function updatePrice() {
    var r = form.querySelector('input[name="packageId"]:checked');
    if (!priceEl) return;
    if (!r || !SOLO_PRICES[r.value]) { priceEl.textContent = ''; return; }
    priceEl.textContent = 'From ' + formatPrice(SOLO_PRICES[r.value]);
  }

  if (weddingDateInput) {
    var today = new Date();
    weddingDateInput.setAttribute('min', today.toISOString().slice(0, 10));
  }

  form.querySelectorAll('.pkg-card').forEach(function(card) {
    card.addEventListener('click', function() {
      form.querySelectorAll('.pkg-card').forEach(function(c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      card.querySelector('input').checked = true;
      updatePrice();
    });
  });
  form.querySelectorAll('input[name="packageId"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      form.querySelectorAll('.pkg-card').forEach(function(c) {
        c.classList.toggle('selected', c.querySelector('input').checked);
      });
      updatePrice();
    });
  });

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim() || undefined,
      weddingDate: form.weddingDate.value.trim() || undefined,
      venue: form.venue.value.trim() || undefined,
      requestedArtist: form.requestedArtist.value || undefined,
      packageId: form.packageId.value || undefined,
      message: form.message.value.trim() || undefined
    };

    fetch(YOUR_APP_URL + '/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res) {
      if (res.ok) {
        try { if (window.top && window.top.location) window.top.location.href = THANK_YOU_URL; } catch (_) {}
        return;
      }
      return res.json().then(function(data) {
        throw new Error(data.error || 'Send failed');
      });
    })
    .catch(function(err) {
      errorEl.textContent = err && err.message ? err.message : 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Inquiry';
    });
  });
})();
</script>
```

---

## 2. DUO (duo inquiry)

Copy from the line `<!--` below through `</script>`.

```html
<!-- Duo inquiry — submissions to app, redirect to request-a-quote-thank-you. Paste full file into Hostinger Embed code. -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Playfair+Display:wght@400&display=swap" rel="stylesheet" />
<style>
  .as-duo-wrap { max-width: 640px; margin: 0 auto; font-family: 'Inter', system-ui, sans-serif; }
  .as-duo-form { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e8e6e1; }
  .as-duo-form label { display: block; margin-bottom: 1rem; font-size: 0.9rem; color: #333; }
  .as-duo-form input, .as-duo-form select, .as-duo-form textarea { display: block; width: 100%; margin-top: 0.35rem; padding: 0.6rem 0.75rem; font-size: 0.95rem; border: 1px solid #ccc; border-radius: 8px; background: #f5ebe0; box-sizing: border-box; font-family: inherit; }
  .as-duo-form textarea { min-height: 100px; resize: vertical; }
  .as-duo-form .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
  .as-duo-form .full { margin-bottom: 1rem; }
  .as-duo-form .pkg-fs { border: none; padding: 1rem 0; margin: 0 0 1rem 0; }
  .as-duo-form .pkg-legend { font-size: 0.9rem; color: #333; margin-bottom: 0.75rem; }
  .as-duo-form .pkg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
  .as-duo-form .pkg-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; background: #fff; transition: border-color 0.2s, box-shadow 0.2s; }
  .as-duo-form .pkg-card:hover { border-color: #3d3630; }
  .as-duo-form .pkg-card.selected { border-color: #3d3630; box-shadow: 0 0 0 2px #3d3630; }
  .as-duo-form .pkg-card input { margin: 0 0 0.5rem 0; width: auto; }
  .as-duo-form .pkg-name { font-size: 0.9rem; text-align: center; }
  .as-duo-form .pkg-price { font-family: 'Inter', system-ui, sans-serif; font-size: 0.8rem; font-weight: 300; color: #555; margin: 0.5rem 0 0 0; }
  .as-duo-form .as-btn { display: block; width: auto; min-width: 160px; margin: 1.5rem auto 0; padding: 0.65rem 2rem; font-size: 1rem; color: #fff; background: #3d3630; border: none; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .as-duo-form .as-btn:hover { background: #2d2620; }
  .as-duo-form .as-btn:disabled { opacity: 0.7; cursor: not-allowed; }
  .as-duo-form .as-err { font-size: 0.9rem; color: #c00; margin-top: 0.75rem; display: none; }
</style>
<div class="as-duo-wrap">
  <div class="as-duo-form" id="as-duo-box">
    <form id="as-duo-f">
      <div class="form-grid">
        <label>Full Name * <input type="text" name="name" placeholder="e.g. Emma Walsh" required /></label>
        <label>Email * <input type="email" name="email" required /></label>
        <label>Phone <input type="tel" name="phone" /></label>
        <label>Wedding Date * <input type="date" name="weddingDate" id="as-duo-weddingDate" required /></label>
        <label>Venue / Location * <input type="text" name="venue" placeholder="e.g. Garden Estate Vineyard" required /></label>
      </div>
      <div class="full">
        <label>Requested duo
          <select name="requestedArtist">
            <option value="">Select duo</option>
            <option value="eli-liv">Eli & Liv</option>
            <option value="riley-richard">Riley & Richard</option>
            <option value="garrett-tamara">Garrett & Tamara</option>
          </select>
        </label>
      </div>
      <fieldset class="pkg-fs">
        <legend class="pkg-legend">Duo Vocal Experience</legend>
        <div class="pkg-grid">
          <label class="pkg-card" data-pkg="signature-aria-duo">
            <input type="radio" name="packageId" value="signature-aria-duo" />
            <span class="pkg-name">Signature Aria Duo</span>
          </label>
          <label class="pkg-card" data-pkg="aria-plus-duo">
            <input type="radio" name="packageId" value="aria-plus-duo" />
            <span class="pkg-name">Aria + Duo</span>
          </label>
          <label class="pkg-card" data-pkg="grand-atelier-duo">
            <input type="radio" name="packageId" value="grand-atelier-duo" />
            <span class="pkg-name">Grand Atelier Duo</span>
          </label>
        </div>
        <p id="as-duo-price" class="pkg-price" aria-live="polite"></p>
      </fieldset>
      <div class="full">
        <label>Message <textarea name="message" placeholder="Tell us about your wedding or any questions." rows="3"></textarea></label>
      </div>
      <p id="as-duo-err" class="as-err" role="alert"></p>
      <button type="submit" class="as-btn" id="as-duo-btn">Send Inquiry</button>
    </form>
  </div>
</div>
<script>
(function(){
  var API = 'https://aurora-sonnet.onrender.com/api/inquiry';
  var THANK_YOU = 'https://aurorasonnet.com/request-a-quote-thank-you';
  var form = document.getElementById('as-duo-f');
  var errEl = document.getElementById('as-duo-err');
  var btn = document.getElementById('as-duo-btn');
  var priceEl = document.getElementById('as-duo-price');
  var weddingDateInput = document.getElementById('as-duo-weddingDate');
  var DUO_PRICES = { 'signature-aria-duo': 4950, 'aria-plus-duo': 6950, 'grand-atelier-duo': 9950 };
  function formatPrice(n) { return '$' + n.toLocaleString(); }
  function updatePrice() {
    var r = form.querySelector('input[name="packageId"]:checked');
    if (!priceEl) return;
    if (!r || !DUO_PRICES[r.value]) { priceEl.textContent = ''; return; }
    priceEl.textContent = 'From ' + formatPrice(DUO_PRICES[r.value]);
  }
  if (weddingDateInput) weddingDateInput.setAttribute('min', new Date().toISOString().slice(0, 10));
  if (!form || !btn) return;
  form.querySelectorAll('.pkg-card').forEach(function(card){
    card.addEventListener('click', function(){
      form.querySelectorAll('.pkg-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      card.querySelector('input').checked = true;
      updatePrice();
    });
  });
  form.querySelectorAll('input[name="packageId"]').forEach(function(radio){
    radio.addEventListener('change', function(){
      form.querySelectorAll('.pkg-card').forEach(function(c){ c.classList.toggle('selected', c.querySelector('input').checked); });
      updatePrice();
    });
  });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    var r = form.querySelector('input[name="packageId"]:checked');
    var payload = {
      name: (form.name && form.name.value) ? form.name.value.trim() : '',
      email: (form.email && form.email.value) ? form.email.value.trim() : '',
      phone: (form.phone && form.phone.value) ? form.phone.value.trim() : undefined,
      weddingDate: (form.weddingDate && form.weddingDate.value) ? form.weddingDate.value.trim() : undefined,
      venue: (form.venue && form.venue.value) ? form.venue.value.trim() : undefined,
      requestedArtist: (form.requestedArtist && form.requestedArtist.value) ? form.requestedArtist.value : undefined,
      packageId: r ? r.value : undefined,
      message: (form.message && form.message.value) ? form.message.value.trim() : undefined
    };
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(res){
        if (res.ok) { try { if (window.top && window.top.location) window.top.location.href = THANK_YOU; } catch(_){} return; }
        return res.json().then(function(d){ throw new Error(d.error || 'Send failed'); });
      })
      .catch(function(err){
        if (errEl) { errEl.textContent = (err && err.message) ? err.message : 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
        btn.disabled = false;
        btn.textContent = 'Send Inquiry';
      });
  });
})();
</script>
```

---

## 3. COMBINED (Solo + Duo on one page)

Copy from the line `<!--` below through `</script>`.

```html
<!-- Combined Solo + Duo inquiry — submissions to app, redirect to request-a-quote-thank-you. Paste full file into Hostinger Embed code. -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Playfair+Display:wght@400&display=swap" rel="stylesheet" />
<style>
  .as-comb-wrap { max-width: 640px; margin: 0 auto; font-family: 'Inter', system-ui, sans-serif; }
  .as-comb-form { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e8e6e1; }
  .as-comb-form label { display: block; margin-bottom: 1rem; font-size: 0.9rem; color: #333; }
  .as-comb-form input, .as-comb-form select, .as-comb-form textarea { display: block; width: 100%; margin-top: 0.35rem; padding: 0.6rem 0.75rem; font-size: 0.95rem; border: 1px solid #ccc; border-radius: 8px; background: #f5ebe0; box-sizing: border-box; font-family: inherit; }
  .as-comb-form textarea { min-height: 100px; resize: vertical; }
  .as-comb-form .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
  .as-comb-form .full { margin-bottom: 1rem; }
  .as-comb-form .pkg-fs { border: none; padding: 1rem 0; margin: 0 0 1rem 0; }
  .as-comb-form .pkg-legend { font-size: 0.9rem; color: #333; margin-bottom: 0.75rem; }
  .as-comb-form .pkg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
  .as-comb-form .pkg-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; background: #fff; transition: border-color 0.2s, box-shadow 0.2s; }
  .as-comb-form .pkg-card:hover { border-color: #3d3630; }
  .as-comb-form .pkg-card.selected { border-color: #3d3630; box-shadow: 0 0 0 2px #3d3630; }
  .as-comb-form .pkg-card input { margin: 0 0 0.5rem 0; width: auto; }
  .as-comb-form .pkg-name { font-size: 0.9rem; text-align: center; }
  .as-comb-form .pkg-hint { font-size: 0.85rem; color: #666; margin: 0.5rem 0; }
  .as-comb-form .pkg-price { font-family: 'Inter', system-ui, sans-serif; font-size: 0.8rem; font-weight: 300; color: #555; margin: 0.5rem 0 0 0; }
  .as-comb-form .as-btn { display: block; width: auto; min-width: 160px; margin: 1.5rem auto 0; padding: 0.65rem 2rem; font-size: 1rem; color: #fff; background: #3d3630; border: none; border-radius: 999px; cursor: pointer; font-family: inherit; }
  .as-comb-form .as-btn:hover { background: #2d2620; }
  .as-comb-form .as-btn:disabled { opacity: 0.7; cursor: not-allowed; }
  .as-comb-form .as-err { font-size: 0.9rem; color: #c00; margin-top: 0.75rem; display: none; }
</style>
<div class="as-comb-wrap">
  <div class="as-comb-form" id="as-comb-box">
    <form id="as-comb-f">
      <div class="form-grid">
        <label>Full Name * <input type="text" name="name" placeholder="e.g. Emma Walsh" required /></label>
        <label>Email * <input type="email" name="email" required /></label>
        <label>Phone <input type="tel" name="phone" /></label>
        <label>Wedding Date * <input type="date" name="weddingDate" id="as-comb-weddingDate" required /></label>
        <label>Venue / Location * <input type="text" name="venue" placeholder="e.g. Garden Estate Vineyard" required /></label>
      </div>
      <div class="full">
        <label>Artist or duo
          <select name="requestedArtist" id="as-comb-artist">
            <option value="">Select artist or duo</option>
            <optgroup label="Solo artist">
              <option value="dr-stephanie-susberich">Dr. Stephanie Susberich</option>
              <option value="blake-friedman">Blake Friedman</option>
            </optgroup>
            <optgroup label="Duo">
              <option value="eli-liv">Eli & Liv</option>
              <option value="riley-richard">Riley & Richard</option>
              <option value="garrett-tamara">Garrett & Tamara</option>
            </optgroup>
          </select>
        </label>
      </div>
      <fieldset class="pkg-fs">
        <legend class="pkg-legend" id="as-comb-pkg-legend">Experience (Solo or Duo)</legend>
        <p class="pkg-hint" id="as-comb-hint">Select an artist or duo above to choose an experience.</p>
        <div class="pkg-grid" id="as-comb-pkg-grid"></div>
        <p id="as-comb-price" class="pkg-price" aria-live="polite"></p>
      </fieldset>
      <div class="full">
        <label>Message <textarea name="message" placeholder="Tell us about your wedding or any questions." rows="3"></textarea></label>
      </div>
      <p id="as-comb-err" class="as-err" role="alert"></p>
      <button type="submit" class="as-btn" id="as-comb-btn">Send Inquiry</button>
    </form>
  </div>
</div>
<script>
(function(){
  var API = 'https://aurora-sonnet.onrender.com/api/inquiry';
  var THANK_YOU = 'https://aurorasonnet.com/request-a-quote-thank-you';
  var SOLO_IDS = ['dr-stephanie-susberich', 'blake-friedman'];
  var DUO_IDS = ['eli-liv', 'riley-richard', 'garrett-tamara'];
  var SOLO_PKGS = [
    { id: 'signature-aria', name: 'Signature Aria' },
    { id: 'aria-plus', name: 'Aria +' },
    { id: 'grand-atelier', name: 'Grand Atelier' }
  ];
  var DUO_PKGS = [
    { id: 'signature-aria-duo', name: 'Signature Aria Duo' },
    { id: 'aria-plus-duo', name: 'Aria + Duo' },
    { id: 'grand-atelier-duo', name: 'Grand Atelier Duo' }
  ];
  var ALL_PRICES = {
    'signature-aria': 2750, 'aria-plus': 3950, 'grand-atelier': 5800,
    'signature-aria-duo': 4950, 'aria-plus-duo': 6950, 'grand-atelier-duo': 9950
  };
  function formatPrice(n) { return '$' + n.toLocaleString(); }
  function updateCombPrice() {
    var r = form.querySelector('input[name="packageId"]:checked');
    var el = document.getElementById('as-comb-price');
    if (!el) return;
    if (!r || !ALL_PRICES[r.value]) { el.textContent = ''; return; }
    el.textContent = 'From ' + formatPrice(ALL_PRICES[r.value]);
  }
  var form = document.getElementById('as-comb-f');
  var artistSelect = document.getElementById('as-comb-artist');
  var pkgGrid = document.getElementById('as-comb-pkg-grid');
  var pkgLegend = document.getElementById('as-comb-pkg-legend');
  var hint = document.getElementById('as-comb-hint');
  var errEl = document.getElementById('as-comb-err');
  var btn = document.getElementById('as-comb-btn');
  var weddingDateInput = document.getElementById('as-comb-weddingDate');
  if (weddingDateInput) weddingDateInput.setAttribute('min', new Date().toISOString().slice(0, 10));
  if (!form || !btn) return;
  function renderPackages() {
    var val = artistSelect ? artistSelect.value : '';
    var isSolo = SOLO_IDS.indexOf(val) !== -1;
    var isDuo = DUO_IDS.indexOf(val) !== -1;
    var pkgs = isSolo ? SOLO_PKGS : isDuo ? DUO_PKGS : [];
    if (hint) hint.style.display = pkgs.length ? 'none' : 'block';
    if (pkgLegend) pkgLegend.textContent = isSolo ? 'Solo experience' : isDuo ? 'Duo experience' : 'Experience (Solo or Duo)';
    pkgGrid.innerHTML = '';
    pkgs.forEach(function(p) {
      var card = document.createElement('label');
      card.className = 'pkg-card';
      card.setAttribute('data-pkg', p.id);
      card.innerHTML = '<input type="radio" name="packageId" value="' + p.id + '"> <span class="pkg-name">' + p.name + '</span>';
      card.addEventListener('click', function() {
        form.querySelectorAll('.pkg-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        card.querySelector('input').checked = true;
        updateCombPrice();
      });
      card.querySelector('input').addEventListener('change', function() {
        form.querySelectorAll('.pkg-card').forEach(function(c) { c.classList.toggle('selected', c.querySelector('input').checked); });
        updateCombPrice();
      });
      pkgGrid.appendChild(card);
    });
    updateCombPrice();
  }
  if (artistSelect) artistSelect.addEventListener('change', function() { form.querySelectorAll('input[name="packageId"]').forEach(function(r) { r.checked = false; }); renderPackages(); });
  renderPackages();
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    var r = form.querySelector('input[name="packageId"]:checked');
    var payload = {
      name: (form.name && form.name.value) ? form.name.value.trim() : '',
      email: (form.email && form.email.value) ? form.email.value.trim() : '',
      phone: (form.phone && form.phone.value) ? form.phone.value.trim() : undefined,
      weddingDate: (form.weddingDate && form.weddingDate.value) ? form.weddingDate.value.trim() : undefined,
      venue: (form.venue && form.venue.value) ? form.venue.value.trim() : undefined,
      requestedArtist: (artistSelect && artistSelect.value) ? artistSelect.value : undefined,
      packageId: r ? r.value : undefined,
      message: (form.message && form.message.value) ? form.message.value.trim() : undefined
    };
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(res) {
        if (res.ok) { try { if (window.top && window.top.location) window.top.location.href = THANK_YOU; } catch(_) {} return; }
        return res.json().then(function(d) { throw new Error(d.error || 'Send failed'); });
      })
      .catch(function(err) {
        if (errEl) { errEl.textContent = (err && err.message) ? err.message : 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
        btn.disabled = false;
        btn.textContent = 'Send Inquiry';
      });
  });
})();
</script>
```

---

**Quick reference**

| Page type | Use block |
|----------|-----------|
| Solo artist inquiry | **1. SOLO** |
| Duo inquiry | **2. DUO** |
| Solo + Duo on one page | **3. COMBINED** |

In Hostinger: add an **HTML** or **Embed** block, then paste the full code for that block (from `<!--` through `</script>`). Save and publish.
