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
<p style="text-align: center;">ARTIST-AGENCY AGREEMENT</p>
<p>This Artist-Agency Agreement ("Agreement") is between Aurora Sonnet ("Agency") and the undersigned performer ("Artist"). This Agreement becomes effective only upon acceptance by Aurora Sonnet (including countersignature or written confirmation).</p>
<p><strong>1. Representation &amp; Scope</strong></p>
<p>The Agency will represent the Artist for the purpose of marketing and negotiating bookings for live performances within New York State and the surrounding metro area.</p>
<p><strong>2. Bookings &amp; Commission</strong></p>
<p>The Agency retains 20% of the Performance Fee; the Artist receives 80%. "Performance Fee" means the total fee for the engagement. The Agency will collect payment from the client and disburse the Artist's share within 14 days of receipt.</p>
<p><strong>3. Performance Standards</strong></p>
<p>The Artist agrees to be punctual, professionally attired, communicative, and to maintain consistent performance quality. The Artist will promptly notify the Agency of any issues that may affect a booking.</p>
<p>Artist details:</p>
<p>Full Legal Name: {{client_name}}</p>
<p>Email: {{client_email}}</p>
<p>Phone: {{client_phone}}</p>
<p>Wedding/Event Date: {{wedding_date}}</p>
<p>Venue: {{venue}}</p>
<p>Package: {{package_type}} — Performance Fee: {{performance_fee}}</p>
<p>{{signature_client}}</p>
<p>AURORA SONNET (AGENCY)</p>
<p>Authorized Representative: Lisa Dubocquet — Founder &amp; Director</p>
<p>{{signature_vendor}}</p>`

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
