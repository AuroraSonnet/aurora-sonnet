import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { ALL_PACKAGES } from '../data/packages'
import styles from './Experiences.module.css'

type DisplayExperience = {
  id: string
  name: string
  description: string
  bullets: string[]
  fromPrice: number
  imageUrl: string | null
  isCustom: boolean
}

export default function Experiences() {
  const { state, actions } = useApp()
  const custom = state.experiences ?? []
  const builtIn: DisplayExperience[] = ALL_PACKAGES.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    bullets: p.bullets,
    fromPrice: p.fromPrice,
    imageUrl: null,
    isCustom: false,
  }))
  const customDisplay: DisplayExperience[] = custom.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    bullets: e.bullets,
    fromPrice: e.fromPrice,
    imageUrl: e.imageUrl,
    isCustom: true,
  }))
  const allExperiences = [...builtIn, ...customDisplay]

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DisplayExperience | null>(null)
  const [form, setForm] = useState({ name: '', description: '', bulletsText: '', fromPrice: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', description: '', bulletsText: '', fromPrice: 0 })
    setError(null)
    setModalOpen(true)
  }

  const openEdit = (exp: DisplayExperience) => {
    if (!exp.isCustom) return
    setEditing(exp)
    setForm({
      name: exp.name,
      description: exp.description,
      bulletsText: exp.bullets.join('\n'),
      fromPrice: exp.fromPrice,
    })
    setError(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const bullets = form.bulletsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const name = form.name.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const result = await actions.updateExperience(editing.id, {
          name,
          description: form.description.trim(),
          bullets,
          fromPrice: form.fromPrice,
        })
        if (result.ok) closeModal()
        else setError(result.error)
      } else {
        const result = await actions.createExperience({
          name,
          description: form.description.trim(),
          bullets,
          fromPrice: form.fromPrice,
        })
        if (result.ok) closeModal()
        else setError(result.error)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (exp: DisplayExperience) => {
    if (!exp.isCustom) return
    if (!window.confirm(`Delete "${exp.name}"?`)) return
    const ok = await actions.deleteExperience(exp.id)
    if (ok) closeModal()
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Experiences</h1>
        <button type="button" className={styles.createBtn} onClick={openCreate}>
          Create new experience
        </button>
      </header>

      <div className={styles.grid}>
        {allExperiences.map((exp) => (
          <article key={exp.id} className={styles.card}>
            <div className={styles.cardBody}>
              <h2 className={styles.cardTitle}>{exp.name}</h2>
              <p className={styles.cardDescription}>{exp.description}</p>
              {exp.bullets.length > 0 && (
                <ul className={styles.cardBullets}>
                  {exp.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
              <p className={styles.cardPrice}>
                From <strong>${exp.fromPrice.toLocaleString()}</strong>
              </p>
            </div>
            {exp.isCustom && (
              <div className={styles.cardActions}>
                <button type="button" className={styles.cardBtn} onClick={() => openEdit(exp)}>
                  Edit
                </button>
                <button type="button" className={`${styles.cardBtn} ${styles.danger}`} onClick={() => handleDelete(exp)}>
                  Delete
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {modalOpen && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <div className={styles.modalHeader}>{editing ? 'Edit experience' : 'New experience'}</div>
              <div className={styles.modalBody}>
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.field}>
                  <label>Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Signature Aria"
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label>Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Short summary of the experience"
                  />
                </div>
                <div className={styles.field}>
                  <label>Included (one per line)</label>
                  <textarea
                    value={form.bulletsText}
                    onChange={(e) => setForm((f) => ({ ...f, bulletsText: e.target.value }))}
                    placeholder="One curated live vocal moment&#10;One bespoke song request"
                    rows={4}
                  />
                </div>
                <div className={styles.field}>
                  <label>From price ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.fromPrice || ''}
                    onChange={(e) => setForm((f) => ({ ...f, fromPrice: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={`${styles.modalBtn} ${styles.secondary}`} onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className={styles.modalBtn} disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
