/**
 * Wedding Music Selection — 8 playlists (4 Ceremony, 4 Reception).
 * Replace with Spotify API fetch in production; structure supports preview_url per track.
 */

export type Category = 'ceremony' | 'reception'

export interface MusicTrack {
  id: string
  name: string
  artist: string
  previewUrl: string | null
}

export interface MusicPlaylist {
  id: string
  title: string
  category: Category
  spotifyUrl: string
  tracks: MusicTrack[]
}

const CEREMONY_PLAYLISTS: MusicPlaylist[] = [
  {
    id: 'guest-arrival',
    title: 'Guest Arrival',
    category: 'ceremony',
    spotifyUrl: 'https://open.spotify.com/playlist/23xftkFak1yusPJJF6dg6R?si=AqKK6lr9SGGnnW0tyYrSpg',
    tracks: [
      {
        id: 'ga-1',
        name: 'Turning Page',
        artist: 'Sleeping At Last',
        previewUrl: 'https://open.spotify.com/track/2kfGoV9a5dbSKCNmUWH2ZF?si=88a8c714394c4a3d',
      },
      {
        id: 'ga-2',
        name: 'River Flows In You',
        artist: 'Yiruma',
        previewUrl: 'https://open.spotify.com/track/2agBDIr9MYDUducQPC1sFU?si=7b7eebba9b574318',
      },
      {
        id: 'ga-3',
        name: 'La Vie en rose',
        artist: 'Édith Piaf',
        previewUrl: 'https://open.spotify.com/track/3lAun9V0YdTlCSIEXPvfsY?si=72f3dee4e9e54ee7',
      },
      {
        id: 'ga-4',
        name: 'Here Comes The Sun - Remastered 2009',
        artist: 'The Beatles',
        previewUrl: 'https://open.spotify.com/track/6dGnYIeXmHdcikdzNNDMm2?si=aeb1159bd4154465',
      },
      {
        id: 'ga-5',
        name: 'The Luckiest',
        artist: 'Ben Folds',
        previewUrl: 'https://open.spotify.com/track/1fujSajijBpJlr5mRGKHJN?si=3065340e1e2b423f',
      },
      {
        id: 'ga-6',
        name: 'Ave Maria',
        artist: 'Céline Dion',
        previewUrl: 'https://open.spotify.com/track/7v6DvsyQHmsQQhmVDmrnZg?si=5d35b664b9c44732',
      },
      {
        id: 'ga-7',
        name: 'In My Life - Remastered 2009',
        artist: 'The Beatles',
        previewUrl: 'https://open.spotify.com/track/3KfbEIOC7YIv90FIfNSZpo?si=99b27afbc7b3474a',
      },
      {
        id: 'ga-8',
        name: 'God Only Knows',
        artist: 'The Beach Boys',
        previewUrl: 'https://open.spotify.com/track/1Umw3vhysHBodpBFpFsVgK?si=a6333ca620c941cb',
      },
    ],
  },
  {
    id: 'processional',
    title: 'Processional',
    category: 'ceremony',
    spotifyUrl: 'https://open.spotify.com/playlist/1Kss5vYLOUwpBHftERE4hG?si=_0hP3kHfTKSj3Rw5cncgrw',
    tracks: [
      {
        id: 'pr-1',
        name: "Can't Help Falling in Love",
        artist: 'Haley Reinhart',
        previewUrl: 'https://open.spotify.com/track/3dqUv6E7L24BDImpGJWYGL?si=fcb238d7377c4c66',
      },
      {
        id: 'pr-2',
        name: 'a thousand years',
        artist: 'Christina Perri',
        previewUrl: 'https://open.spotify.com/track/6lanRgr6wXibZr8KgzXxBl?si=832183d875204254',
      },
      {
        id: 'pr-3',
        name: 'Perfect',
        artist: 'Ed Sheeran',
        previewUrl: 'https://open.spotify.com/track/0tgVpDi06FyKpA1z0VMD4v?si=ed0cfd847ca94443',
      },
      {
        id: 'pr-4',
        name: 'At Last',
        artist: 'Etta James',
        previewUrl: 'https://open.spotify.com/track/4Hhv2vrOTy89HFRcjU3QOx?si=e6b5b6f8e4d741c2',
      },
      {
        id: 'pr-5',
        name: 'Until I Found You',
        artist: 'Stephen Sanchez',
        previewUrl: 'https://open.spotify.com/track/0T5iIrXA4p5GsubkhuBIKV?si=a20cbe5a575b46f8',
      },
      {
        id: 'pr-6',
        name: 'How Long Will I Love You',
        artist: 'Ellie Goulding',
        previewUrl: 'https://open.spotify.com/track/3fA8bXrZL4mYhHbkkMgFH5?si=eb0ef9aa030a4960',
      },
    ],
  },
  {
    id: 'interlude',
    title: 'Interlude',
    category: 'ceremony',
    spotifyUrl: 'https://open.spotify.com/playlist/3sjLjXYT1tDrioTXjuHMPr?si=qoHx5-Q7R4uIUXbQtd8hrQ',
    tracks: [
      {
        id: 'in-1',
        name: 'All of Me',
        artist: 'John Legend',
        previewUrl: 'https://open.spotify.com/track/0Q7Jp3aCwfYnSnbMDoXWyR?si=a3b71256656749c2',
      },
      {
        id: 'in-2',
        name: 'From This Moment On',
        artist: 'Shania Twain, Bryan White',
        previewUrl: 'https://open.spotify.com/track/25U7raB3ZSszayTYClh4hF?si=226c952abd044e30',
      },
      {
        id: 'in-3',
        name: 'Somewhere Over The Rainbow/What A Wonderful World',
        artist: "Israel Kamakawiwo'ole",
        previewUrl: 'https://open.spotify.com/track/5FgPwJ7Nh2FVmIXviKl2VF?si=9a893c07e0444489',
      },
      {
        id: 'in-4',
        name: 'Make You Feel My Love',
        artist: 'Adele',
        previewUrl: 'https://open.spotify.com/track/6zlY4xmlgqvn4LxjzoS2mz?si=c55960a8622943d7',
      },
      {
        id: 'in-5',
        name: 'The Prayer',
        artist: 'Céline Dion, Andrea Bocelli',
        previewUrl: 'https://open.spotify.com/track/3U4isOIWM3VvDubwSI3y7a?si=cce98ff8acaa47a3',
      },
    ],
  },
  {
    id: 'recessional',
    title: 'Recessional',
    category: 'ceremony',
    spotifyUrl: 'https://open.spotify.com/playlist/6hffXSD5wkjby8BJouEzm0?si=YD5y0IX7QT-wgVoAC0iJZw',
    tracks: [
      {
        id: 'rc-1',
        name: "Signed, Sealed, Delivered (I'm Yours)",
        artist: 'Stevie Wonder',
        previewUrl: 'https://open.spotify.com/track/2C5SI38AMmqckQGnD1H2FO?si=37eeee58475348ff',
      },
      {
        id: 'rc-2',
        name: 'This Will Be (An Everlasting Love)',
        artist: 'Natalie Cole',
        previewUrl: 'https://open.spotify.com/track/0PDCewmZCp0P5s00bptcdd?si=528ab61818754f10',
      },
      {
        id: 'rc-3',
        name: 'You Make My Dreams (Come True)',
        artist: 'Daryl Hall & John Oates',
        previewUrl: 'https://open.spotify.com/track/4o6BgsqLIBViaGVbx5rbRk?si=a8177d0c42114da7',
      },
      {
        id: 'rc-4',
        name: 'Marry You',
        artist: 'Bruno Mars',
        previewUrl: 'https://open.spotify.com/track/22PMfvdz35fFKYnJyMn077?si=c98ed556569c4e0a',
      },
      {
        id: 'rc-5',
        name: "I'm Yours",
        artist: 'Jason Mraz',
        previewUrl: 'https://open.spotify.com/track/1EzrEOXmMH3G43AXT1y7pA?si=a154774895ce41ef',
      },
    ],
  },
]

const RECEPTION_PLAYLISTS: MusicPlaylist[] = [
  {
    id: 'cocktail-hour',
    title: 'Cocktail Hour',
    category: 'reception',
    spotifyUrl: 'https://open.spotify.com/playlist/3sQ3XKizVPfmVuniFNq3dW?si=Pl2ECZvkTW-ODzEaAsS7Mg',
    tracks: [
      {
        id: 'ch-1',
        name: 'The Way You Look Tonight',
        artist: 'Michael Bublé',
        previewUrl: 'https://open.spotify.com/track/4YGlRLe6TeBRiXFByBqldf?si=8739d7b154994167',
      },
      {
        id: 'ch-2',
        name: 'So Easy (To Fall In Love)',
        artist: 'Olivia Dean',
        previewUrl: 'https://open.spotify.com/track/6sGIMrtIzQjdzNndVxe397?si=7e96f33b683c4cf8',
      },
      {
        id: 'ch-3',
        name: 'L-O-V-E',
        artist: 'Nat King Cole',
        previewUrl: 'https://open.spotify.com/track/4QxDOjgpYtQDxxbWPuEJOy?si=ef0fd02a20874f8b',
      },
      {
        id: 'ch-4',
        name: 'Cheek To Cheek',
        artist: 'Ella Fitzgerald, Louis Armstrong',
        previewUrl: 'https://open.spotify.com/track/33jt3kYWjQzqn3xyYQ5ZEh?si=8208476a18d542e9',
      },
      {
        id: 'ch-5',
        name: 'Come Away With Me',
        artist: 'Norah Jones',
        previewUrl: 'https://open.spotify.com/track/6jGnykaS6TkWp15utXSAeI?si=719faaf2ac9e4e79',
      },
      {
        id: 'ch-6',
        name: 'Fly Me To The Moon',
        artist: 'Frank Sinatra',
        previewUrl: 'https://open.spotify.com/track/1PVTvvxpSkyJWemW1CwVVk?si=4cba860df9684af8',
      },
      {
        id: 'ch-7',
        name: 'The Girl From Ipanema',
        artist: 'Astrud Gilberto',
        previewUrl: 'https://open.spotify.com/track/4uC7IrfS1oQuRCVzqj1EJV?si=fed071e82f6d401a',
      },
      {
        id: 'ch-8',
        name: 'Unforgettable',
        artist: 'Nat King Cole',
        previewUrl: 'https://open.spotify.com/track/648TTtYB0bH0P8Hfy0FmkL?si=fc0a7fcf1c92451d',
      },
    ],
  },
  {
    id: 'first-dance',
    title: 'First Dance',
    category: 'reception',
    spotifyUrl: 'https://open.spotify.com/playlist/5YF6BfRtcnsbRha7GjsIM4?si=FtycMPndSnWr1SjH938uPg',
    tracks: [
      {
        id: 'fd-1',
        name: 'At Last',
        artist: 'Etta James',
        previewUrl: 'https://open.spotify.com/track/4Hhv2vrOTy89HFRcjU3QOx?si=e3db5b528e904501',
      },
      {
        id: 'fd-2',
        name: "Can't Help Falling in Love",
        artist: 'Haley Reinhart',
        previewUrl: 'https://open.spotify.com/track/3dqUv6E7L24BDImpGJWYGL?si=7bfd1e22823e43e1',
      },
      {
        id: 'fd-3',
        name: 'I Will Always Love You',
        artist: 'Whitney Houston',
        previewUrl: 'https://open.spotify.com/track/4eHbdreAnSOrDDsFfc4Fpm?si=f033b38d106d47df',
      },
      {
        id: 'fd-4',
        name: 'Make You Feel My Love',
        artist: 'Adele',
        previewUrl: 'https://open.spotify.com/track/5FgPwJ7Nh2FVmIXviKl2VF?si=db44b04e54ee4ba7',
      },
      {
        id: 'fd-5',
        name: 'Beyond',
        artist: 'Leon Bridges',
        previewUrl: 'https://open.spotify.com/track/1Omt5bfz1tZUCqd26HxbS0?si=120bc9be332147ae',
      },
      {
        id: 'fd-6',
        name: 'Best Part (feat. H.E.R.)',
        artist: 'Daniel Caesar, H.E.R.',
        previewUrl: 'https://open.spotify.com/track/1Q7EgiMOuwDcB0PJC6AzON?si=9cabc62f60834b87',
      },
      {
        id: 'fd-7',
        name: 'a thousand years',
        artist: 'Christina Perri',
        previewUrl: 'https://open.spotify.com/track/6lanRgr6wXibZr8KgzXxBl?si=9f3c0a60f7274a3b',
      },
      {
        id: 'fd-8',
        name: 'Perfect',
        artist: 'Ed Sheeran',
        previewUrl: 'https://open.spotify.com/track/0tgVpDi06FyKpA1z0VMD4v?si=81319c8038a24062',
      },
    ],
  },
  {
    id: 'parent-dance',
    title: 'Parent Dance',
    category: 'reception',
    spotifyUrl: 'https://open.spotify.com/playlist/2qoOf7qSvfHEGahebLjVi3?si=XlYnf0OLRKyPJXx7gvS4Ug',
    tracks: [
      {
        id: 'pd-1',
        name: 'My Girl',
        artist: 'The Temptations',
        previewUrl: 'https://open.spotify.com/track/745H5CctFr12Mo7cqa1BMH?si=aacbfa8197684c0e',
      },
      {
        id: 'pd-2',
        name: 'What A Wonderful World',
        artist: 'Louis Armstrong',
        previewUrl: 'https://open.spotify.com/track/29U7stRjqHU6rMiS8BfaI9?si=30a90247c36e4ae5',
      },
      {
        id: 'pd-3',
        name: 'The Way You Look Tonight',
        artist: 'Michael Bublé',
        previewUrl: 'https://open.spotify.com/track/4YGlRLe6TeBRiXFByBqldf?si=b621041d4235450f',
      },
      {
        id: 'pd-4',
        name: 'Stand By Me',
        artist: 'Ben E. King',
        previewUrl: 'https://open.spotify.com/track/3SdTKo2uVsxFblQjpScoHy?si=6853bb5a68c34361',
      },
      {
        id: 'pd-5',
        name: 'Unforgettable',
        artist: 'Nat King Cole',
        previewUrl: 'https://open.spotify.com/track/648TTtYB0bH0P8Hfy0FmkL?si=7f9d4ef95f0145d8',
      },
      {
        id: 'pd-6',
        name: "You'll Be In My Heart",
        artist: 'Phil Collins',
        previewUrl: 'https://open.spotify.com/track/4Y8vb1uy9IjM2V1hqvrAid?si=be46dab7fcbd4d24',
      },
      {
        id: 'pd-7',
        name: 'God Only Knows',
        artist: 'The Beach Boys',
        previewUrl: 'https://open.spotify.com/track/1Umw3vhysHBodpBFpFsVgK?si=14019b470877486a',
      },
    ],
  },
  {
    id: 'highlights',
    title: 'Highlights',
    category: 'reception',
    spotifyUrl: 'https://open.spotify.com/playlist/0cUocF8g1YpSsIPuToxksx?si=Bqi7Trn3R7yr0Wm-ES1yeQ',
    tracks: [
      {
        id: 'hl-1',
        name: 'Love Me Like You Do - From "Fifty Shades Of Grey"',
        artist: 'Ellie Goulding',
        previewUrl: 'https://open.spotify.com/track/3zHq9ouUJQFQRf3cm1rRLu?si=d4567b09715448a3',
      },
      {
        id: 'hl-2',
        name: 'September',
        artist: 'Earth, Wind & Fire',
        previewUrl: 'https://open.spotify.com/track/2grjqo0Frpf2okIBiifQKs?si=47c22bfaa0634c9f',
      },
      {
        id: 'hl-3',
        name: 'Crazy In Love (feat. JAY-Z)',
        artist: 'Beyoncé, JAY-Z',
        previewUrl: 'https://open.spotify.com/track/5IVuqXILoxVWvWEPm82Jxr?si=35eca123b3a64421',
      },
      {
        id: 'hl-4',
        name: 'Valerie - Amy Winehouse',
        artist: 'Amy Winehouse',
        previewUrl: 'https://open.spotify.com/episode/36uvKErfVOtOrDSk6sYsVX?si=dd2c35992d4f4c05',
      },
      {
        id: 'hl-5',
        name: 'Crazy Little Thing Called Love - Remastered',
        artist: 'Queen',
        previewUrl: 'https://open.spotify.com/track/35ItUJlMtjOQW3SSiTCrrw?si=4089587c1c114cfe',
      },
      {
        id: 'hl-6',
        name: 'I Wanna Dance with Somebody (Who Loves Me)',
        artist: 'Whitney Houston',
        previewUrl: 'https://open.spotify.com/track/2tUBqZG2AbRi7Q0BIrVrEj?si=0d94a17154b6463a',
      },
      {
        id: 'hl-7',
        name: 'Dancing in the Moonlight',
        artist: 'Toploader',
        previewUrl: 'https://open.spotify.com/track/3Fzlg5r1IjhLk2qRw667od?si=ca6f617e0b644c5c',
      },
    ],
  },
]

export const WEDDING_MUSIC_PLAYLISTS: MusicPlaylist[] = [...CEREMONY_PLAYLISTS, ...RECEPTION_PLAYLISTS]
