import { useState, useRef, useEffect, useCallback } from 'react'
import { apiUpdateContractTemplateContent } from '../api/db'
import styles from './ContractTemplateEditor.module.css'

export const MERGE_FIELDS = [
  { key: 'client_name', label: 'Client name' },
  { key: 'client_email', label: 'Client email' },
  { key: 'client_phone', label: 'Client phone' },
  { key: 'wedding_date', label: 'Wedding date' },
  { key: 'venue', label: 'Venue' },
  { key: 'package_type', label: 'Package type' },
  { key: 'performance_fee', label: 'Performance fee' },
  { key: 'project_title', label: 'Project title' },
] as const

export const SIGNATURE_BLOCKS = [
  { key: 'signature_client', label: "Client's signature" },
  { key: 'signature_vendor', label: "Vendor / Agency signature" },
] as const

const PLACEHOLDER_PREFIX = '{{'
const PLACEHOLDER_SUFFIX = '}}'

/** Convert stored HTML (with {{key}} placeholders) to editor HTML (with spans). */
function placeholdersToSpans(html: string): string {
  let out = html
  for (const { key, label } of [...MERGE_FIELDS, ...SIGNATURE_BLOCKS]) {
    const placeholder = `${PLACEHOLDER_PREFIX}${key}${PLACEHOLDER_SUFFIX}`
    const span = `<span data-merge="${key}" contenteditable="false" class="${styles.mergeField}">${label}</span>`
    out = out.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), span)
  }
  return out
}

/** Convert editor HTML back to stored format ({{key}} placeholders). */
function spansToPlaceholders(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(`[data-merge]`).forEach((el) => {
    const key = el.getAttribute('data-merge')
    if (key) {
      const text = doc.createTextNode(`${PLACEHOLDER_PREFIX}${key}${PLACEHOLDER_SUFFIX}`)
      el.parentNode?.replaceChild(text, el)
    }
  })
  return doc.body.innerHTML
}

const DEFAULT_CONTENT = `<p style="text-align: center;"><strong>AURORA SONNET</strong></p>
<p style="text-align: center;"><strong>ARTIST AGENCY AGREEMENT</strong></p>
<p>This Agreement is entered into between Aurora Sonnet ("Agency") and the undersigned Artist or Artist's legal entity ("Artist").</p>
<p>The purpose of this Agreement is to establish a professional relationship in which Aurora Sonnet represents the Artist for live performance opportunities including weddings and private events.</p>
<p><strong>1. Representation</strong></p>
<p>The Artist appoints Aurora Sonnet as a non-exclusive booking agency for live performance engagements.</p>
<p>The Artist remains free to pursue and accept independent bookings outside of the Agency.</p>
<p><strong>2. Commission</strong></p>
<p>Aurora Sonnet will receive a twenty percent (20%) commission on all engagements secured, negotiated, or introduced by the Agency.</p>
<p>The Artist will receive the remaining eighty percent (80%) of the Performance Fee.</p>
<p>"Performance Fee" means the agreed performance price. For events located more than 50 miles from New York City, travel, lodging, equipment rentals, and similar expenses may be treated separately from the Performance Fee unless otherwise agreed.</p>
<p><strong>3. Booking Confirmation</strong></p>
<p>Before the Agency confirms a booking, the Artist must confirm availability and acceptance.</p>
<p>The Agency will disclose the identity of the client when requesting the Artist's confirmation.</p>
<p>The Agency will not finalize a booking without the Artist's confirmation.</p>
<p>The Artist agrees to respond to booking inquiries within a reasonable timeframe. If the Artist does not respond in time, the Agency may offer the engagement to another artist.</p>
<p><strong>4. Client Payment Structure</strong></p>
<p>Clients booking through Aurora Sonnet must pay:</p>
<ul>
<li>a 50% non-refundable retainer to secure the booking</li>
<li>the remaining 50% no later than 15 days before the event</li>
</ul>
<p>If the final payment is not received on time, the Agency may cancel the engagement and the Artist will not be required to perform.</p>
<p><strong>5. Artist Payment</strong></p>
<p>After the engagement is completed and the client has paid in full, the Agency will pay the Artist their 80% share of the Performance Fee.</p>
<p>Payment will be issued within three (3) business days after the engagement is completed.</p>
<p><strong>6. Travel &amp; Expenses</strong></p>
<p>For events requiring travel beyond the local area, the Agency will provide an approved travel budget.</p>
<p>The Artist may arrange travel and lodging within that budget.</p>
<p>After the engagement, the Artist may submit receipts for reimbursement. The Agency will reimburse approved expenses once receipts are received.</p>
<p>If travel costs are expected to exceed the approved budget, the Artist must contact the Agency before booking.</p>
<p>The Artist is responsible for planning travel so they arrive with enough time to prepare and perform as scheduled.</p>
<p><strong>7. Cancellations</strong></p>
<p>Client cancellations follow the terms of the Client Agreement, including the 50% non-refundable retainer.</p>
<p>If a client cancels and the Agency retains any portion of the Performance Fee, the Artist will receive 80% of the retained Performance Fee.</p>
<p>In the rare and unfortunate event that the client receives a full refund, no Artist payment is owed.</p>
<p>If the Artist cancels a confirmed engagement without a legitimate emergency, the Agency may secure a replacement artist. The cancelling Artist may be responsible for reasonable, documented costs directly incurred by the Agency in securing a replacement, but not exceeding the Artist's expected share of the Performance Fee.</p>
<p>If an engagement cannot take place due to circumstances beyond the control of the parties — including natural disasters, government restrictions, venue closure, or serious illness — the Agency and Artist will work together in good faith to reschedule or otherwise resolve the engagement.</p>
<p><strong>8. Media &amp; Promotional Content</strong></p>
<p>Photos and videos created or produced by Aurora Sonnet for promotional purposes remain the property of the Agency.</p>
<p>The Artist may use these photos and videos for personal promotion, including their website and social media, but may not provide, license, or allow another agency or representation company to use them without the Agency's written consent.</p>
<p>Clients may not use the Artist's name, likeness, or performance footage for commercial purposes without the Artist's prior written consent. Personal, non-commercial sharing is permitted.</p>
<p>The Artist may not record, film, or publish content from a private event without the client's written consent.</p>
<p>If the Artist is no longer represented by Aurora Sonnet and requests in writing that their photos or videos be removed, the Agency will remove such materials from its website, social media, and any other platforms used by the Agency to promote the Artist within a reasonable timeframe.</p>
<p>⸻</p>
<p><strong>9. Non-Circumvention</strong></p>
<p>The Artist agrees not to bypass the Agency for bookings introduced, negotiated, or secured by Aurora Sonnet.</p>
<p>This protection applies for twelve (12) months following the introduction or performance, whichever occurs later.</p>
<p>If a client introduced by the Agency books the Artist directly within that period, the Agency remains entitled to its 20% commission.</p>
<p><strong>10. Excluded Client List</strong></p>
<p>Before signing this Agreement, the Artist may provide an Excluded Client List.</p>
<p>Clients on that list:</p>
<ul>
<li>are not subject to Agency commission</li>
<li>may continue booking the Artist independently</li>
</ul>
<p>If any client on the Excluded Client List contacts the Agency directly, the Agency is not obligated to offer the Artist for that engagement and may instead refer another artist represented by the Agency.</p>
<p><strong>11. Independent Contractor, Insurance, Equipment &amp; Conduct</strong></p>
<p>The Artist is engaged as an independent contractor, not as an employee of Aurora Sonnet.</p>
<p>The Artist is responsible for their own taxes, insurance, permits, business expenses, and performance equipment.</p>
<p>Any additional equipment, rentals, or special requirements requested by the client must be approved in advance and paid by the client.</p>
<p>If a venue requires proof of insurance, the Agency may arrange coverage for that engagement. Otherwise, the Artist is responsible for maintaining any required insurance.</p>
<p>The Artist agrees to maintain professional conduct and discretion regarding client information and private events and to deliver a professional performance consistent with the style and quality represented to the Agency and the client.</p>
<p><strong>12. Term &amp; Termination</strong></p>
<p>Either party may terminate this Agreement with 30 days written notice.</p>
<p>Bookings confirmed before termination remain subject to this Agreement.</p>
<p>This Agreement is governed by the laws of the State of New York.</p>
<p><br></p>
<p><strong><em>ARTIST INFORMATION</em></strong></p>
<p>Artist / Company Legal Name: {{client_name}}</p>
<p>Stage Name (if applicable): __________________________</p>
<p>Authorized Representative (if company): __________________________</p>
<p>Address: __________________________</p>
<p>Email: {{client_email}}</p>
<p>Phone: {{client_phone}}</p>
<p><br></p>
<p><strong><em>AURORA SONNET (AGENCY)</em></strong></p>
<p>Aurora Sonnet LLC</p>
<p>Authorized Representative: Lisa Dubocquet</p>
<p>Title: Founder &amp; Director</p>
<p><br></p>
<p>Artist Signature: {{signature_client}}</p>
<p><br></p>
<p>Agency Signature: {{signature_vendor}}</p>`

export type ContractTemplateEditorProps = {
  templateId: string
  templateName: string
  initialContentHtml: string
  onClose: () => void
  onSaved?: () => void
}

export default function ContractTemplateEditor({
  templateId,
  templateName,
  initialContentHtml,
  onClose,
  onSaved,
}: ContractTemplateEditorProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false)
  const [signatureMenuOpen, setSignatureMenuOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const initialHtml = placeholdersToSpans(initialContentHtml || DEFAULT_CONTENT)

  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.innerHTML = initialHtml
  }, [initialHtml])

  const getEditorHtml = useCallback((): string => {
    return editorRef.current?.innerHTML ?? initialHtml
  }, [initialHtml])

  const insertHtml = useCallback((html: string) => {
    const sel = window.getSelection()
    const editor = editorRef.current
    if (!sel || !editor) return
    editor.focus()
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const frag = document.createRange().createContextualFragment(html)
      range.insertNode(frag)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    setFieldMenuOpen(false)
    setSignatureMenuOpen(false)
  }, [])

  const execFormat = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
  }, [])

  const handleInsertField = (key: string, label: string) => {
    insertHtml(
      `<span data-merge="${key}" contenteditable="false" class="${styles.mergeField}">${label}</span>`
    )
  }

  const handleSave = async () => {
    const html = getEditorHtml()
    const stored = spansToPlaceholders(html)
    setError('')
    setSaving(true)
    try {
      const ok = await apiUpdateContractTemplateContent(templateId, stored)
      if (ok) {
        onSaved?.()
        onClose()
      } else {
        setError('Failed to save')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Edit contract template">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button type="button" onClick={onClose} className={styles.backBtn} aria-label="Back">
              ←
            </button>
            <div>
              <h2 className={styles.title}>{templateName}</h2>
              <p className={styles.savedHint}>Saved templates — save to store changes</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={onClose} className={styles.cancelBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={styles.useTemplateBtn}
            >
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <button type="button" onClick={() => execFormat('bold')} className={styles.toolbarBtn} title="Bold">
            <b>B</b>
          </button>
          <button type="button" onClick={() => execFormat('italic')} className={styles.toolbarBtn} title="Italic">
            <i>I</i>
          </button>
          <button type="button" onClick={() => execFormat('underline')} className={styles.toolbarBtn} title="Underline">
            <u>U</u>
          </button>
          <span className={styles.toolbarDivider} />
          <div className={styles.dropdownWrap}>
            <button
              type="button"
              onClick={() => setFieldMenuOpen((o) => !o)}
              className={styles.toolbarBtn}
              aria-expanded={fieldMenuOpen}
            >
              Add field
            </button>
            {fieldMenuOpen && (
              <ul className={styles.dropdown}>
                {MERGE_FIELDS.map(({ key, label }) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => handleInsertField(key, label)}
                      className={styles.dropdownItem}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.dropdownWrap}>
            <button
              type="button"
              onClick={() => setSignatureMenuOpen((o) => !o)}
              className={styles.toolbarBtn}
              aria-expanded={signatureMenuOpen}
            >
              Add signature
            </button>
            {signatureMenuOpen && (
              <ul className={styles.dropdown}>
                {SIGNATURE_BLOCKS.map(({ key, label }) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => handleInsertField(key, label)}
                      className={styles.dropdownItem}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div
          ref={editorRef}
          className={styles.editor}
          contentEditable
          suppressContentEditableWarning
        />
      </div>
    </div>
  )
}
