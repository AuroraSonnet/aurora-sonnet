# Fix “Form not found” — use your real Formspree hashid

The error means the **form hashid** in your code doesn’t match a form in your Formspree account. Do this once:

---

## 1. Get your form hashid from Formspree

1. Go to **https://formspree.io** and sign in.
2. Open **Forms** in the sidebar (or dashboard).
3. Click the form you use for the general inquiry (or **+ New form** to create one).
4. You’ll see the form **Endpoint** URL, e.g.:
   ```text
   https://formspree.io/f/mwkdgpzy
   ```
   The **hashid** is the part **after** `/f/` — in this example it’s **mwkdgpzy** (yours will be different).
5. Copy **only that ID** (e.g. `mwkdgpzy`). Do not copy the full URL.

---

## 2. Put the hashid in your form code

In the form code on Hostinger, find this line:

```html
<form class="aurora-general-form" action="https://formspree.io/f/YOUR_FORMSPREE_ID" method="post">
```

Replace **YOUR_FORMSPREE_ID** with your actual hashid, so it looks like:

```html
<form class="aurora-general-form" action="https://formspree.io/f/mwkdgpzy" method="post">
```

(Use your own hashid, not `mwkdgpzy`.)

Save the page. After that, “Form not found” should be gone and submissions will go to Formspree and redirect to your thank-you page.
