<p align="center">
   <img src="https://github.com/mistakia/record-app/raw/master/resources/icon.png" alt="Record Logo" width="150" />
</p>

## Introduction

### What is Record?
Record is an immutable distributed system for audio files. It can be used for managing a personal music collection and potentially powering the digital music ecosystem (distribution, discovery, etc).
- Supports: mp3, mp4, m4a/aac, flac, wav, ogg, 3gpp, aiff
- Audio file tag support via [Music Metadata](https://github.com/Borewit/music-metadata)
- Audio fingerprinting via [Chromaprint](https://acoustid.org/chromaprint)
- Listening history w/ counter and timestamps
- Tagging system for organization
- Play / Shuffle search results & organizational tags
- Import files from the local file system
- Import from various web-based sources: Youtube, Soundcloud, Bandcamp, etc
  - [Record Chrome extension](https://github.com/mistakia/record-chrome-extension)
- Content deduplication
- Play queue

As a distributed network, Record passes data from application to application. Therefore, it does not rely on any one entity, rather it is spread out and made accessible by anyone running the application. Users only keep the data they are interested in and make it available for others. Each application is a "full node" designed to continue working even if the project is abandoned and you are the only person using it.

Record is built using only the [InterPlanetary File System (IPFS)](https://ipfs.io/) & [OrbitDB](https://orbitdb.org/) / [IPFS-Log](https://github.com/orbitdb/ipfs-log) protocols, inheriting all of their qualities (i.e. immutable, censorship resistant, distributed and content deduplication). At the moment, Record is not reliant on any consensus driven distributed systems (i.e. cryptocurrencies). In the future, one may be used for data anchoring and value transfer (i.e. payments) if they meet the core principles of the project.

### Why?
In short, to achieve immutability & interoperability of audio metadata and files.

### Goals?
To experiment with the viability of an open protocol and a fully distributed system to address the problems of centralized music silos. Anyone who manages a large music collection knows the pains of keeping it forever and navigating the disjointed music ecosystem.

To cultivate and support content creators by allowing them to distribute to anyone, forever, and get rewarded for their creativity, cutting out all intermediaries.

To bring back & elevate curators - referring to the era of radio DJs and bloggers that either succumbed to the music industry or fatigue. Making it easier to manage a digital music collection will spawns curators who then discover and elevate content creators.

### How is this different from X?
Record aims to be fully distributed where all functionality is self-contained in each application (i.e. a "full" node). There have been and will be similar projects but many tend to have some elements where the functionality is not self-contained and too much is reliant on external services. Our goal is to avoid federation and resist any crutches, either technically or practically, that reduce fully distributed functionality.

- [beets](https://github.com/beetbox/beets) [needs documentation]
- [tomahawk player](https://github.com/tomahawk-player/tomahawk) [needs documentation]
- Ex.fm (deprecated)
- [Mediachain](https://github.com/mediachain/mediachain) [needs documentation]
- [Open Music Initiative](https://github.com/omi/RAIDAR) [needs documentation]
- [Ujo](https://github.com/ConsenSysMesh/ujo-backend) [needs documentation]
- [Audius](https://github.com/AudiusProject) [needs documentation]

### Status
Like many projects in the distributed web ecosystem, this remains an unstable experiment despite on and off development since 2015. In other words, it is not ready for general use. Until it is stable, it is most suitable for those who have an appetite for problems and a desire to shape the solutions.

### Getting Involved
- Report bugs on [github](https://github.com/mistakia/record-app/issues).
- Ask questions, share ideas & enhancements on [github](https://github.com/mistakia/record-app/discussions).
- Ask questions via [@ipfsrecord](https://twitter.com/ipfsrecord).
- Contribute ideas, code & documentation.

## Roadmap
Check out [the roadmap](https://github.com/mistakia/record-app/projects/1) to view planned features.
- Metadata cleaning / import using: discogs, musicbrainz, last.fm, allmusic, beatport, streaming services, etc
- Media server (MPD, Sonos, Plex, Kodi, Emby)
- Audio and music analysis (Aubio, Essentia)
- Audio Scrobbling (last.fm, libre.fm, listenbrainz)
- Trustless timestamping / distributed copyrighting & distribution ([OpenTimestamps](https://opentimestamps.org/), [Nano](https://github.com/nanocurrency/nano-node), etc)

## Guides
### Getting Started
1. Download the ~~desktop app~~

### Installing chrome extension
1. Download [chrome-extension](https://github.com/mistakia/record-chrome-extension/releases) & unzip
2. Open chrome and go to `chrome://extensions`
3. Enable developer mode (top-right)
4. Select `Load unpacked` navigate to unzipped directory and select the `dist` folder
5. Make sure the record chrome extension is activated

### Importing files
[needs documentation]

## Troubleshooting
### NAT traversal
In many situations, users will be behind a router and will need to enable UPnP or nat-pmp in order to connect to others. The best way to do this is to google your specific router brand for instructions on how to enable them.

## Glossary

### IPFS Peer
A computer running IPFS.

### Record Peer
A computer running the Record application or an instance of [record-node](https://github.com/mistakia/record-node). A peer can have many libraries. A record peer is also always an IPFS peer but not vice-versa.

### Identity
A public / private key pair. Users can have multiple identities.

### Library
A collection of tracks and links to other libraries. Each Library has at least one assoicated Identity. Currently, there is no global registry of libraries. Discovery occurs by examining the social graph, by out-of-band sharing, or peer discovery on the network.

More specifically, a library is an immutable operation-based [conflict-free replicated data structure](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) resembling a [directed acyclic graph](https://en.wikipedia.org/wiki/Directed_acyclic_graph). Each Library has a Manifest and an Access Controller, specifying which keys/signatures are accepted.

#### Library Address
The library address is an IPFS hash of the log\'s manifest. Thus each address is unique to a manifest.
```JavaScript
/orbitdb/zdpuAqeuT5BQnyXMTnvL5xWHVBUXSs4HMxgpbVgErnd8Doi6p/record
```

#### Library Manifest
The library manifest contains a name for the library along with the hash to an access controller, which specifies who has the ability to modify the Library. There are multiple types of [access controllers](https://github.com/orbitdb/orbit-db-access-controllers/tree/master/src) (i.e. OrbitDB, IPFS, Ethereum, custom).

```JavaScript
{
  name: 'record',
  type: 'recordstore',
  accessController: '/ipfs/zdpuB3KRtqMVSjLX9KbFV3nKDwjuvYaPYjy2HBTjVKUNsgmRQ'
}
```

#### Library Access Controller (IPFS)
Specifies public keys to be used to validate signatures of entries
```JavaScript
{
  write: [
    "020b646ed922bfa7ee4359bf771f79ffa2ff7e937f3a5fb8a596a08632ea23c809" // public key
  ]
}
```

#### Entry
Each entry is a signed operation (`PUT` or `DEL`) modifying the state of the Library that references previous entries in the Library.
```JavaScript
{
  hash: 'zdpuAnctNUahQ2hRBeVSt7B3ymMKZ1qiHcGZUS8vABbwQ9LBs', // Entry hash
  id: '/orbitdb/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/record', // Library address
  payload: [object], // (see below)
  next: [], // previous entry in the log
  refs: [], // references to other entries, allows for skipping around
  v: 2,
  clock: {
    id: '04acd9157fa11657871091339c1063ef96d7695480a9a96dc77a0748e7fc6152127f8bd60d463c85b4fa7b12a8ec95d004333220b4e2d1d9f9c6e8cbf923ad9fb6',
    time: 1
  },
  key: '04acd9157fa11657871091339c1063ef96d7695480a9a96dc77a0748e7fc6152127f8bd60d463c85b4fa7b12a8ec95d004333220b4e2d1d9f9c6e8cbf923ad9fb6',
  identity: {
    id: '03bfc24f6f79222a9727bc562ba199aaf6d288fd59887a0ba3e896d33a074d6360',
    publicKey: '04acd9157fa11657871091339c1063ef96d7695480a9a96dc77a0748e7fc6152127f8bd60d463c85b4fa7b12a8ec95d004333220b4e2d1d9f9c6e8cbf923ad9fb6',
    signatures: {
      id: '304402207c6983968279ea0030f6d3cf77d9300decbd017a9a41cc6e9f9b3f650d9ab8aa02205ec25a846e41d7121ab7071bea8d2a8331ba0004922fd970248dc86b4ed9df18',
      publicKey: '304402206f93cb29c361cde07d11cbed80dec737a6578defcdd86b815830dc250a9ef25c022006030f4f8d6c25f679caa6e4102da0edaab50d847f9463aba9ff0d981cc51583'
    },
    type: 'orbitdb'
  },
  sig: '3045022100b0005ac464d90d9744bc7ec0b85f46170219a9c88f0dc53c2c3e7612faae29d602202a48f22184b12e57a3508c3f8eccddde7cf2f8a79a70ca114ac29cd7087369be'
}
```

#### Entry Payload
There are three types of entry payloads, conducting two operations (`PUT` or `DEL`), with a content addressable pointer to the data. In the case of a `track` entry, the `content` is a content addressable pointer to the metadata of the audio file. Within the metadata is another content addressable pointer to the audio data.
```JavaScript
{
  op: 'PUT', // PUT or DEL
  key: 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f',
  value: {
    id: 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f', // hash of audio fingerprint for track entries
    timestamp: 1611272666695,
    v: 0,
    type: 'about', // about, track, or library
    content: 'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1dk' // IPFS CID (see below)
  }
}
```

#### Entry Payload Content - Track
The metadata of an audio file with a content addressable pointer ot the audio data. Tracks are identified by their [audio fingerprint](https://acoustid.org/chromaprint). Two tracks in two different libraries with the same audio fingerprint will have the same id and will be treated as the same. In the future, the audio fingerprint can be used to determine the similarity of any two tracks.

Audio files are processed by separating the metadata from the audio data, so that the audio data alone is content addressable and unique on the entire network.

The `content` property of an Entry payload is the CID of the following object. Any changes to the following object will result in a different CID. However, two exact audio files will have the same audio fingerprint and entry payload `id` / `key`.
```JavaScript
{
  hash: 'QmQNBMWZexMA2EEhsc7BMoqnjWRqf5irXk6osNnh7oqNjS', // IPFS hash of audio data
  size: 15476630,
  tags: {
    disk: [Object],
    genre: [Array],
    title: 'So Much Love To Give(Original Mix)',
    track: [Object],
    artist: 'Dj Falcon And Thomas Bangalter',
    artists: [Array],
    acoustid_fingerprint: 'AQADtE0ikWIYpAoFrYkWhNaCZpSO55i0-LiOkMvyQMoX-LcQHj22E9XR8cIN9PiQ5FKQ5wdb_JhiG_V-XCjCB19O6HzwJ4XmB3kUNB6O6sUm_Qma_EJ-5ZCuHM055IF_9DQmtYF1_IT_od-OWhOSuEFYEqxE_MdkO2jiLDhy7kje4-Hxp0mQQ0-KsBSacsdfVIuP6LqgPUuO7NHRHKWO2vDzY1Lx3CjQD7mQ5AmeHyyuY4pt1MqPGzX6IOZOXHrwp3gfhF_QWMFRPSU26U_g_MjC69CVI8yF4zccE5vYHNXxEI2LH9eQxA3CkmAlHj8mUUwD66iRK0je43yEPE1wHXqSIsyFmjt-VItjzNSF8FlySI-O5kZ4oR_8o-ox7cIN9MIzKOfxgO2wH41To1Z-3KiFXsh54nxwPQ3yGLWGxspxVE-x6haq68iVQPoeNLuQv_BfnM7h8-h4VIfPoB-OZBSHLB0u59iP6mngZziSPcK1Bw8f_GkC_UWuEE2nHN2V4sekhQpyQeOk5EV2od_QHPuM5j3eH88P_zD64UGSE3kIVsdpTHFjVFR-HLXRh8iXEzcf_GnwxgifCM1xVE-x6kGof9ArHcyHML-CWkfz49SDaUeTPniDHnZ07EIyikNmDpcw9uiZBtbRI9-hHw93PE0CHTE1odfRhDx-4wuHT0XkJTt0HVlyo9bRHz7FoeKPKjx8uKg55DySS9JB48UuGnbTGDce9EG940fOB9fTIPTxEM1z_PiN6ojUKhV0KQfzD2F-oZQOvzQOh2LiosoD9EXjDR8SXch5zMGbH10zBz5z9MgPHf8DnbTwq0GuCY11VOSK36hIYapjIbmWIzua6eg19BPhCuNPPDx8-OiR80hyCQ_B_riOKW4aoyfu4PiRL8f54HoahO7hR0E__ET3GN8R6fJwKYGUI70S_PBvHG-DLZmOhwF84UMkikgehTnwB0wSz0cfBHrkI0c-SejyJ9CssPgRljOcBz--I9Q1SN_RI-fxw8yW4zwcCs8u-CROIT2S8UNxJTmYhzgvNOGWDTf8Hc0j7EQ-7SjJ422QExupo2izw7oD50KW69BO5JE-9DnaD354XISTtrhS-HxxwR-Sa0Ku5CjzHBcP0lfQfCmOHNqJ__hGoZT4BDqLI_1xXNkRVD-kH0X6w6U--MfhSKgyNK9CnCtS6MjZoF2igD3QhGKMj4J1NNeJ5PjWoyQpwTfEOEd69ETF5TArLrA-ZNET6KiRJx_-ws-CS4LVw6FJXIevBEWyD3mD9niPJrwD0pzgA8lSDsfzScL0J9AzFtMR_vBx4x-S6QcfD-Fh8jB7-MvxG46IZ_Al5Jyg5QiaHeYSgjnxownFGBf8ozl2E1-PkORxFzmPLccpOMtY_BwcrUfN9Uj2BZlG2WiO88ZPvMnRJH8x_Q2O_vCFZB-iLwN7PMHod2jEpiEq87jwI5eOP3j3BNdT5JrQStHh8Ay63IipQpcQXbqMC0x2_PCH83jeB1t6GEf4EcmHPWBzXDomH00eGy-No-iPB7dunExR7Ufzjbhy_HhexOYTKF6YIo_AP2iu4y-8Ho-wpeFDVOGLo7nQB8kZRD9Y4Vmw56jyNHDMowdi8njwP8FFpsijCb12-GRQZTZiSYUuIbp0GReYDH_hD-fx98GW8DAehB-SD3sGNnFwHpOPJo-Nl8ZR9MeDWzdOpqj2o_mOK8SPJy9i8wkUL0yRR-CP5rrwF16PB1vMh6hyA82FPkgeRD8ONgv2o8rToDmPI5B_HL-uQCfTIC-qMoelCr-DR0afIDmi52Byo9TRH1Mq6qh-OGFlHD56IXp2JBcF-seLXQ8au0fl48GPH_lyXOSDJw3CxsY3NFaOH78x6aIQXsclJZDyw5eQH_6NM3AuF5PyAM3RY5eCnEhU8piDN_nRlQ78HH2OHDrkPzjpBDF7PEPzo-Ky4qZRLdIRfoJy7UHug0kv9EI_w5WPqj5R5caOHz_CZ0hiLaB_HLt-2G5w6nhwPLqQ7zgfXE8a1DbSD72CE1X0GOMVhFfAK4f2Hem_4NKD5qVxH03M5ESVo8d2TJ-CD8l1ZD3mKLjzoyvTwOdR9YgJ_fgDOY8TnEeeoGmP6it-fJFWRE-hKwevI8yP8tgXNDdR1SeqHD-OHtGzI7kI-seL68cUu0Gt4MLxRke-41zyoHfwI08U-EN1TNOP6sGVDtkD7cqD9KZwvvDxFFvMh6hyo_DRDzuSI2uOebjzDl2ZBj4v9EiO489wLk6g8sgzNN1RffheVDsmbhdyJYeUI925oSx6ND_G9kSVH-7hoh-iZ0gu6gSNF7se2O7xHEcf9EK-PDh5PA1CH3Yy9MRPTNPj4D_CJxWkC7mO5hv-wD9OvM0LJw_go5-QXBHyxAeLK8f0xkZzGg_wHjElPA9-Vagf5ItgK0PxE9N0Naj-IRf4QIu_IKdN-MeHm6mKTT-qo0dz7MiDRMVVzHxxZz8aPT36HIGO_Cdy7gpOp4GeAiMcYEIQIjABIAGhhAAGKQIQQAYJApRCCQAhBBDCMDCgoAAjAZRCAgFGmFAGeEKEAUYAYRRlgABAgUEEGGQIAAAxQQQCghoAhADEICoeMZZEiJxCBBFGlBRMCCKgAMI4iglgFgKhhCJCEQCAMUwAARVIQBAmkDNCEICAcBYASRhBBgiAlFAGEEAMoMALZC0CAiAADAAGSCEkI4ABY4AgAgGCjhMCEAAMEgRAw8iCiCBBCHKECkI5YEIYwARClBEDgGIMQWCIAAxAaJQAQimhgBTGGGIEUEhQChgSEBgBFDAUDWAAIIYJYwRSmCABGFMGQUGEQUYAxaQxTAABAACSAGiUoQQKQoEihQHDDFAGqCgAQMQZ4YghhChIEGFAAaSAMYAYKpSwBghGADEOCUGEMAAgYIGghBgIAFBAWKoEcAwoK4gYAAFGhCFCaYCccI4Q4QRQxBABCVQCMQAYMkQISAhAbAAFBCPECGQQUFYRgRgA0AAgiOMCIoWAUApIJIgRQhCDCCAGCKAAIEIIYpgCwDimBADCGCEQAQwyKQgDBjALEALEKSOccWQQAgBQighgAFMECIYIFQImRZQixBAGHBkCAAIMQQQwhgRhAAFmAULEKSOccWQQAgAAihpAAFMGCIYIFRQpphQxhgDmgCMBAKAMMA4ZZCgjBCFBlSEQAEOEAZYpzKQxQEijgBTGGGIMogIKwgxFTBgEiEAKQIOCIUAJJoQgQgiLiRJIIAAlAIYIA4BlSDmDmAAAABCkMQIYYAgSSAAKEGAMCUAEYJI5pgBQCAkhAVGCCCAhAoIigQyBABiCDEAAOIMIUEghIoGhUAEECBJUIGQYA4AABAgUlCjEhABOMGEMBoYYIAwBhggDGGVAHEMEVQZIAARCCCFKoCAMAMoAEgYRABigDBGgFJBACGiQAMgBBKxSyhkDACAAQAKAEQAY'
  },
  audio: {
    codec: 'MPEG 1 Layer 3',
    bitrate: 192000,
    duration: 644.7804081632653,
    lossless: false,
    tagTypes: [Array],
    container: 'MPEG',
    trackInfo: [],
    sampleRate: 44100,
    codecProfile: 'CBR',
    numberOfSamples: 28434816,
    numberOfChannels: 2
  },
  artwork: [],
  resolver: []
}
```

#### Entry Payload Content - Library
```JavaScript
{
  alias: null,
  address: '/orbitdb/zdpuArGrfHp6oejutegRoitSZrhwdtMB3m8NNRJP5a2HATkQf/record'
}
```

#### Entry Payload Content - About
```JavaScript
{
  bio: 'a test node',
  name: 'Test Node',
  avatar: null,
  address: '/orbitdb/zdpuArBbSSmtXFXf7pm3KAn16XRXMwVWDABNUDPekUeE74r7Z/record',
  location: 'test world'
}
```

## FAQs

### Is this illegal? What about copyright infringement?
Like many things, it depends on how you use it. There is currently no mechanism to detect or prevent copyright infringement on the network. We have many ideas on how to address copyright infringement like a distributed copyright registration system that allows users to observe copyright and detect infringement. However, there will never be a way to prevent someone from committing copyright infringement that wants to do so. That decision is ultimately left up to each person. Our goal is to limit infringement to only those who willfully want to commit it.

### What happens when I link a library?
You will replicate and maintain a copy of the metadata, not the actual audio, of all the tracks that are in that library while receiving any future updates. Libraries you link to are made available for others to discover.

### What happens when I unlink a library?
You will stop receiving any updates to that library and its metadata will eventually be removed from your computer, along with any audio files that exclusively belonged to that library. To further clarify, if you saved a track from another library and then unlink it, you will maintain that track.

### What happens when I try to play a track?
You are searching your local computer and network for the audio file. If found, it is played. If it belongs to a library that you have linked, the audio file will be kept, otherwise it will eventually be removed from your computer.

### What happens when I star a track?
You are adding this track to your library and maintaining the audio file on your computer.

### Will there be data on my computer that I have not asked for?
Never. You only get data that you request and you will only keep data that you have chosen to maintain.

### How do I search for a track?
There is no network wide search mechanism and we have no plans on making one. You can only search for tracks within the libraries you are connected to.

### How do I find a library?
Each library has a unique address that can be shared.

## Core Principles
1. Distributed - self-contained and independent.
2. Open - free flow of information, permissionless, community governed.

## Concepts

### Replication / Synchronization
[needs documentation]

### Linking
[needs documentation]
