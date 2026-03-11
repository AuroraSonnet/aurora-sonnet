import type { MusicPlaylist } from './weddingMusicPlaylists'

const OPERA_CEREMONY: MusicPlaylist[] = [
  {
    id: 'op-guest-arrival',
    title: 'Guest Arrival | Prelude',
    category: 'ceremony',
    spotifyUrl: '',
    tracks: [
      { id: 'op-ga-1', name: 'Ave Maria', artist: 'Schubert', previewUrl: 'https://open.spotify.com/track/46DZCruzZuDWYinEI25UPo?si=c3baa104660c4329' },
      { id: 'op-ga-2', name: 'Nella Fantasia', artist: 'Morricone', previewUrl: 'https://open.spotify.com/track/2zKdobJbYRXtEJ9V6g4MTB?si=20ad966601d147bc' },
      { id: 'op-ga-3', name: 'Ombra Mai Fu', artist: 'Handel', previewUrl: 'https://open.spotify.com/track/4wrLflj8Wx0MX95GLHoC4M?si=67c9169c6f274e86' },
      { id: 'op-ga-4', name: 'Laudate Dominum', artist: 'Mozart', previewUrl: 'https://open.spotify.com/track/0rLNlmlBu09jmo5jFUiMX2?si=8b2e5a331aaf4087' },
      { id: 'op-ga-5', name: 'Pie Jesu', artist: 'Fauré', previewUrl: 'https://open.spotify.com/track/0hRh3LBZh2xwt0lz7iwOD0?si=b172d606c1874ca1' },
      { id: 'op-ga-6', name: 'Ave Maria', artist: 'Bach / Gounod', previewUrl: 'https://open.spotify.com/track/3u6UxbqZGBnnAQFYJFg7U4?si=1a59b842cd574bab' },
    ],
  },
  {
    id: 'op-processional',
    title: 'Processional | Recessional',
    category: 'ceremony',
    spotifyUrl: '',
    tracks: [
      { id: 'op-pr-1', name: 'O Mio Babbino Caro', artist: 'Puccini', previewUrl: 'https://open.spotify.com/track/1utyEW4Qf1F5jeqhJSLT6g?si=64ac3b9c9f46464a' },
      { id: 'op-pr-2', name: "Lascia Ch'io Pianga", artist: 'Handel', previewUrl: 'https://open.spotify.com/track/6FZfM0IatK4g8zFebCXI0m?si=94b79bce5e5548e0' },
      { id: 'op-pr-3', name: 'Flower Duet', artist: 'Delibes', previewUrl: 'https://open.spotify.com/track/2xORus0TIDTVKatLletu1B?si=26d0ad4bfcea44cc' },
      { id: 'op-pr-4', name: 'Alleluia', artist: 'Mozart', previewUrl: 'https://open.spotify.com/track/0SyplLJ970zjJwJBxmi94L?si=e5078335aeea4e2e' },
      { id: 'op-pr-5', name: "The Lord's Prayer", artist: 'Malotte', previewUrl: 'https://open.spotify.com/track/6FIIUfFP8C88y51k1zi5O3?si=dea45c8f53c94c70' },
      { id: 'op-pr-6', name: 'Una Furtiva Lagrima', artist: 'Donizetti', previewUrl: 'https://open.spotify.com/track/7DKv6FjD4xxeT4ZmEdec9W?si=c115b42fb07c4feb' },
    ],
  },
]

const OPERA_RECEPTION: MusicPlaylist[] = [
  {
    id: 'op-cocktail',
    title: 'Cocktail Hour',
    category: 'reception',
    spotifyUrl: '',
    tracks: [
      { id: 'op-ch-1', name: "Quando Me'n Vo", artist: 'Puccini', previewUrl: 'https://open.spotify.com/track/7Eg5cn0RZSdttryjTaylnh?si=b15d114b43114f0c' },
      { id: 'op-ch-2', name: 'Non Ti Scordar Di Me', artist: 'De Curtis', previewUrl: 'https://open.spotify.com/track/42My9HbN4tnqIzhMZF7Qag?si=ebbad955b804444c' },
      { id: 'op-ch-3', name: 'Ideale', artist: 'Tosti', previewUrl: 'https://open.spotify.com/track/2UwWuJ4fqsl0LGOnU5dowr?si=ebf73aa334a543ea' },
      { id: 'op-ch-4', name: 'Musica Proibita', artist: 'Gastaldon', previewUrl: 'https://open.spotify.com/track/5mQSU4PmUU68k80c82XrRZ?si=b7fe8180a8054c8e' },
      { id: 'op-ch-5', name: 'Deh Vieni Non Tardar', artist: 'Mozart', previewUrl: 'https://open.spotify.com/track/3ivUxiiLHnB5QyYRelvdtH?si=b118890849704984' },
    ],
  },
  {
    id: 'op-dinner',
    title: 'Dinner Serenade',
    category: 'reception',
    spotifyUrl: '',
    tracks: [
      { id: 'op-ds-1', name: 'The Prayer', artist: 'Bocelli / Celine Dion', previewUrl: 'https://open.spotify.com/track/6zlY4xmlgqvn4LxjzoS2mz?si=51925dd2a967448b' },
      { id: 'op-ds-2', name: 'Time to Say Goodbye', artist: 'Bocelli', previewUrl: 'https://open.spotify.com/track/3VAICuY2ax2yCLT7EhNeZE?si=d722c8c2a2a444e3' },
      { id: 'op-ds-3', name: 'You Raise Me Up', artist: 'Josh Groban', previewUrl: 'https://open.spotify.com/track/4TbNLKRLKlxZDlS0pu7Lsy?si=08babfc9f0b84416' },
      { id: 'op-ds-4', name: 'Casta Diva', artist: 'Bellini', previewUrl: 'https://open.spotify.com/track/3Ia9cMRJU5XG9mzmu9colm?si=f5e373e492744228' },
      { id: 'op-ds-5', name: 'Caro Mio Ben', artist: 'Giordani', previewUrl: 'https://open.spotify.com/track/27uGtazwGTJ1XPhvPUjaGX?si=8f235bd9a7f04a14' },
      { id: 'op-ds-6', name: 'A Vucchella', artist: 'Tosti', previewUrl: 'https://open.spotify.com/track/62Mq4PMuKont9j1cwR2U81?si=c81ed0d3cfb14c14' },
    ],
  },
  {
    id: 'op-signature',
    title: 'Signature Moments',
    category: 'reception',
    spotifyUrl: '',
    tracks: [
      { id: 'op-sm-1', name: 'Nessun Dorma', artist: 'Puccini', previewUrl: 'https://open.spotify.com/track/2XeYlM8XKFCP6DYsKWZdh2?si=c600425fe7f24a40' },
      { id: 'op-sm-2', name: "Can't Help Falling in Love", artist: 'Elvis Presley', previewUrl: 'https://open.spotify.com/track/44AyOl4qVkzS48vBsbNXaC?si=52a3bde6364d4b90' },
      { id: 'op-sm-3', name: "Libiamo ne' lieti calici", artist: 'Verdi', previewUrl: 'https://open.spotify.com/track/41ujv4mhxlqR8nlnieDpDp?si=b4b1c222cc4543c2' },
      { id: 'op-sm-4', name: 'Un Bel Di Vedremo', artist: 'Puccini', previewUrl: 'https://open.spotify.com/track/69EKwvg7nkdOO3RmeUMJZG?si=ec1ef006c02043c4' },
      { id: 'op-sm-5', name: 'O Sole Mio', artist: 'Di Capua', previewUrl: 'https://open.spotify.com/track/42SXU1x4wUVaFovkvjABt7?si=2991da6f944d4e64' },
    ],
  },
]

export const OPERA_MUSIC_PLAYLISTS: MusicPlaylist[] = [...OPERA_CEREMONY, ...OPERA_RECEPTION]
