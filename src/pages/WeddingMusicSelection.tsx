import { useState, useCallback } from 'react'
import {
  WEDDING_MUSIC_PLAYLISTS,
  type MusicPlaylist,
  type MusicTrack,
  type Category,
} from '../data/weddingMusicPlaylists'
import styles from './WeddingMusicSelection.module.css'

function getSelectedGrouped(
  playlists: MusicPlaylist[],
  selectedIds: Set<string>
): { category: Category; playlistTitle: string; tracks: MusicTrack[] }[] {
  const out: { category: Category; playlistTitle: string; tracks: MusicTrack[] }[] = []
  for (const pl of playlists) {
    const tracks = pl.tracks.filter((t) => selectedIds.has(t.id))
    if (tracks.length === 0) continue
    out.push({ category: pl.category, playlistTitle: pl.title, tracks })
  }
  return out
}

export default function WeddingMusicSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openIds, setOpenIds] = useState<Set<string>>(new Set([WEDDING_MUSIC_PLAYLISTS[0]?.id ?? '']))

  const count = selectedIds.size
  const minMin = count * 3
  const maxMin = count * 4
  const timeRange = count === 0 ? '0 min' : `${minMin}–${maxMin} min`
  const timeSub = count === 0 ? '0 songs selected' : `${count} song${count === 1 ? '' : 's'} selected · ~3–4 min each`

  const toggleTrack = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const togglePlaylist = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handlePlay = useCallback((track: MusicTrack) => {
    const url =
      track.previewUrl ||
      `https://open.spotify.com/search/${encodeURIComponent(`${track.name} ${track.artist}`)}`
    window.open(url, '_blank', 'noopener,noreferrer,width=480,height=640')
  }, [])

  const grouped = getSelectedGrouped(WEDDING_MUSIC_PLAYLISTS, selectedIds)
  const ceremonyPlaylists = WEDDING_MUSIC_PLAYLISTS.filter((p) => p.category === 'ceremony')
  const receptionPlaylists = WEDDING_MUSIC_PLAYLISTS.filter((p) => p.category === 'reception')

  const handleSubmit = () => {
    // Wire to your API or mailto when embedding
    const payload = { selectedTrackIds: Array.from(selectedIds), count }
    console.log('Submit selections', payload)
    alert(`Selections submitted (${count} song${count === 1 ? '' : 's'}). Connect this form to your backend or email.`)
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.timeSummary}>
          <h1 className={styles.timeSummaryTitle}>Estimated Live Performance Time</h1>
          <p className={styles.timeSummaryRange}>{timeRange}</p>
          <p className={styles.timeSummarySub}>{timeSub}</p>
        </header>

        <div className={styles.sectionDivider}>
          <h2 className={styles.sectionTitle}>Ceremony</h2>
        </div>
        {ceremonyPlaylists.map((pl) => (
          <section key={pl.id} className={styles.playlistSection}>
            <button
              type="button"
              className={styles.playlistHeader}
              onClick={() => togglePlaylist(pl.id)}
              aria-expanded={openIds.has(pl.id)}
            >
              <span className={styles.playlistHeaderLabel}>
                {pl.title.toUpperCase()} – Ceremony
              </span>
              <svg
                className={`${styles.chevron} ${openIds.has(pl.id) ? styles.chevronOpen : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {openIds.has(pl.id) && (
              <div className={styles.playlistTracks}>
                {pl.tracks.map((track) => (
                  <div key={track.id} className={styles.trackRow}>
                    <input
                      type="checkbox"
                      id={`track-${track.id}`}
                      className={styles.trackCheckbox}
                      checked={selectedIds.has(track.id)}
                      onChange={() => toggleTrack(track.id)}
                    />
                    <label htmlFor={`track-${track.id}`} className={styles.trackLabel}>
                      {track.name} — {track.artist}
                    </label>
                    <button
                      type="button"
                      className={styles.trackPlayBtn}
                      onClick={() => handlePlay(track)}
                      title="Open in Spotify"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        <div className={styles.sectionDivider}>
          <h2 className={styles.sectionTitle}>Reception</h2>
        </div>
        {receptionPlaylists.map((pl) => (
          <section key={pl.id} className={styles.playlistSection}>
            <button
              type="button"
              className={styles.playlistHeader}
              onClick={() => togglePlaylist(pl.id)}
              aria-expanded={openIds.has(pl.id)}
            >
              <span className={styles.playlistHeaderLabel}>
                {pl.title.toUpperCase()} – Reception
              </span>
              <svg
                className={`${styles.chevron} ${openIds.has(pl.id) ? styles.chevronOpen : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {openIds.has(pl.id) && (
              <div className={styles.playlistTracks}>
                {pl.tracks.map((track) => (
                  <div key={track.id} className={styles.trackRow}>
                    <input
                      type="checkbox"
                      id={`track-${track.id}`}
                      className={styles.trackCheckbox}
                      checked={selectedIds.has(track.id)}
                      onChange={() => toggleTrack(track.id)}
                    />
                    <label htmlFor={`track-${track.id}`} className={styles.trackLabel}>
                      {track.name} — {track.artist}
                    </label>
                    <button
                      type="button"
                      className={styles.trackPlayBtn}
                      onClick={() => handlePlay(track)}
                      title="Open in Spotify"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        <div className={styles.sectionDivider}>
          <h2 className={styles.sectionTitle}>Your Selected Songs</h2>
        </div>
        <div className={styles.selectedSection}>
          <div className={styles.selectedCard}>
            {grouped.length === 0 ? (
              <p className={styles.emptySelected}>No songs selected yet. Choose from the playlists above.</p>
            ) : (
              grouped.map((g) => (
                <div key={`${g.category}-${g.playlistTitle}`}>
                  <h3 className={styles.selectedCategoryTitle}>
                    {g.category.toUpperCase()} – {g.playlistTitle}
                  </h3>
                  {g.tracks.map((t) => (
                    <div key={t.id} className={styles.selectedTrackItem}>
                      {t.name} — {t.artist}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <p className={styles.footerNote}>
            Final selections are kindly requested 21 days prior to your event to allow time for thoughtful preparation.
          </p>
          <button type="button" className={styles.submitBtn} onClick={handleSubmit}>
            Submit Selections
          </button>
        </div>
      </div>
    </div>
  )
}
