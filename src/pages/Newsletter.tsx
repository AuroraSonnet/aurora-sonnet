import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { appendSignature } from '../utils/emailSignature'
import styles from './Newsletter.module.css'

export default function Newsletter() {
  const { state, actions } = useApp()
  const { clients, newsletterTemplates } = state

  const emails = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const c of clients) {
      const email = (c.email || '').trim()
      if (!email) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(email)
    }
    return result
  }, [clients])

  const emailsText = emails.join(', ')

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [subject, setSubject] = useState('Aurora Sonnet newsletter')
  const [body, setBody] = useState('Hi there,\n\n')

  const handleSelectTemplate = (id: string) => {
    const t = newsletterTemplates.find((x) => x.id === id)
    setSelectedTemplateId(id)
    if (t) {
      setTemplateName(t.name)
      setSubject(t.subject)
      setBody(t.body)
    }
  }

  const handleSaveNewTemplate = () => {
    const name = templateName.trim()
    if (!name) return
    actions.addNewsletterTemplate({ name, subject, body })
  }

  const handleUpdateTemplate = () => {
    if (!selectedTemplateId) return
    actions.updateNewsletterTemplate(selectedTemplateId, {
      name: templateName.trim() || 'Untitled',
      subject,
      body,
    })
  }

  const handleDeleteTemplate = (id: string) => {
    if (!window.confirm('Delete this newsletter template?')) return
    actions.deleteNewsletterTemplate(id)
    if (selectedTemplateId === id) {
      setSelectedTemplateId(null)
    }
  }

  const handleCopy = async () => {
    if (!emailsText) return
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(emailsText)
        // best-effort only; no UI toast for now
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = emailsText
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
    } catch {
      // ignore copy errors
    }
  }

  const handleOpenMail = () => {
    if (!emails.length) return
    const bcc = encodeURIComponent(emails.join(','))
    const subj = encodeURIComponent(subject || 'Aurora Sonnet newsletter')
    const bodyWithSignature = appendSignature(body || 'Hi there,\n\n')
    window.location.href = `mailto:?bcc=${bcc}&subject=${subj}&body=${encodeURIComponent(bodyWithSignature)}`
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Newsletter</h1>
        <p className={styles.subtitle}>Grab all client emails for Mailchimp, Flodesk, or a one-off broadcast.</p>
      </header>

      <section className={styles.card}>
        <h2>Client email list</h2>
        <p>These are all unique client email addresses currently in your CRM.</p>
        <textarea
          className={styles.textarea}
          value={emailsText}
          readOnly
          placeholder="No client emails yet."
        />
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={handleCopy} disabled={!emails.length}>
            Copy emails
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={handleOpenMail} disabled={!emails.length}>
            Email all via Mail
          </button>
        </div>
        <p className={styles.hint}>
          Tip: paste into the BCC field of your email app, or import into your newsletter platform. Large lists may work
          better via CSV export on the Clients page.
        </p>
      </section>

      <section className={`${styles.card} ${styles.templatesCard}`}>
        <div className={styles.templatesHeader}>
          <h2>Newsletter templates</h2>
        </div>
        {newsletterTemplates.length > 0 && (
          <ul className={styles.templatesList}>
            {newsletterTemplates.map((t) => (
              <li key={t.id} className={styles.templateItem}>
                <div>
                  <div className={styles.templateName}>{t.name}</div>
                  <div className={styles.templateMeta}>Subject: {t.subject || '—'}</div>
                </div>
                <div className={styles.templateButtons}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => handleSelectTemplate(t.id)}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => handleDeleteTemplate(t.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="newsletter-template-name">
            Template name
          </label>
          <input
            id="newsletter-template-name"
            className={styles.input}
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. Spring update"
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="newsletter-subject">
            Subject line
          </label>
          <input
            id="newsletter-subject"
            className={styles.input}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="newsletter-body">
            Email body
          </label>
          <textarea
            id="newsletter-body"
            className={styles.textarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={handleSaveNewTemplate}>
            Save as new template
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={handleUpdateTemplate}
            disabled={!selectedTemplateId}
          >
            Update selected
          </button>
        </div>
        <p className={styles.hint}>
          Choose a template, tweak the subject and body, then use Email all via Mail above or copy into your newsletter
          platform.
        </p>
      </section>
    </div>
  )
}

