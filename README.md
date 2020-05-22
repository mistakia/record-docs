## Introduction

### What is Record?
Record is an immutable distributed system for managing a music collection.

### How does it work?
As a distributed network, Record passes the data from application to application. Therefore, it does not rely on any one person or company, rather it is spread out and made accessible by anyone running the application. Most importantly, it will continue to work if the people behind the project abandon it or decide to shut it down and you are the only person using it.

Record is built on the [IPFS](https://ipfs.io/) & [OrbitDB](https://orbitdb.org/) protocol, thus it inherits all of their qualities (i.e. immutable, censorship resistant, distributed and content deduplication).

### Why?
In short, to achieve immutability & interoperability. Anyone who manages a large music collection knows the pains of keeping it forever and navigating the disjointed music space.

### Goals?
To start, the main focus is to ease the pain of managing & enjoying a large digital music collection.

Next, the focus shifts to cultivating and supporting the content creators who make these collections possible. First, by allowing them to distribute to anyone, forever, and eventually, by helping them focus on their art and get rewarded for their creativity, cutting out all intermediaries. We have a lot more to say on this later.

Finally, we want to bring back & elevate curators. We are referring to the radio DJs and bloggers of the past that either succumbed to the music industry or fatigue. These all go hand-in-hand. When you make it easier to manage a digital music collection, that spawns curators who then discover and elevate content creators.

### How is this different from X?
Record aims to be fully distributed where all functionality is self-contained. There have been and will be similar projects but they tend to have some elements where the functionality is not fully self-contained and reliant on some external services. Our goal is to avoid federation and resist any crutches, either technically or practically, that reduce fully distributed functionality.

[work in progress - need examples]

### Who is this for?
This is an experiment and is in the early phases of development. In other words, it is not ready for use and has a long road ahead. Until it is stable, it is most suitable for those who have an appetite for problems and a desire to shape the solutions.

### Getting Started
1. Download the [desktop app](https://github.com/mistakia/record-app/releases)

[work in progress]

### Getting Involved
- Report bugs & enhancements on [github](https://github.com/mistakia/record-app/issues).
- Ask questions via [@ipfsmusic](https://twitter.com/ipfsmusic).
- Contribute code & documentation.

## FAQs

### Is this illegal? What about copyright infringement?
No. Like many things, it depends on how you use it. There is currently no mechanism to detect or prevent copyright infringement on the network. We have many plans to address copyright infringement like a distributed copyright registration system that allows users to observe copyright and detect infringement. However, there will never be a way to prevent someone from committing copyright infringement. That decision is ultimately left up to each person. Our goal is to limit infringement to only those who willfully want to commit it.

### What happens when I link a library?
You will replicate and maintain a copy of the metadata, not the actual audio, of all the tracks that are in that library while receiving any future updates. Libraries you link to are made available for others to discover.

### What happens when I unlink a library?
You will stop receiving any updates to that library and its metadata will eventually be removed from your computer, along with any audio files that exclusively belonged to that library. To further clarify, if you saved a track from another library and then unlink it, you will maintain that track.

### What happens when I try to play a track?
You are searching your local computer and network for the audio file. If found, it is played. If it belongs to a library that you have linked, the audio file will be kept, otherwise it will eventually be removed from your computer.

### What happens when I star a track?
You are adding this track to your library and maintaining the audio file on your computer.

### Will there be data on my computer that I have not asked for?
Never. You only get data that you request, through your actions, and you will only keep data that you have chosen to maintain.

### How do I search for a track?
There is no network wide search mechanism and we have no plans on making one. You can only search for tracks within the libraries you have.

### How do I find a library?
Each library has a unique address that can be shared.

## Guides
### Installing chrome extension
1. Download [chrome-extension](https://github.com/mistakia/record-chrome-extension/releases) & unzip
2. Open chrome and go to `chrome://extensions`
3. Enable developer mode (top-right)
4. Select `Load unpacked` navigate to unzipped directory and select the `dist` folder
5. Make sure the record chrome extension is activated

### Importing files
[work in progress]

## Concepts

### Replication / Synchronization
Users choose which libraries to synchronize with and thus make them available for others. [work in progress]

### Linking
Users choose which libraries to persist by linking them to their library. Additionally, this creates a link to that library within their library making it discoverable to those synchronizing with them.

## Troubleshooting
### NAT traversal
In many situations, users will be behind a router and will need to enable UPnP or nat-pmp in order to connect to others. The best way to do this is to google your specific router brand for instructions on how to enable them.

## Design
[work in progress]

## Glossary

### Identity
A public / private key pair. Users can have multiple identities.

### Library / Log
A collection of tracks and links to other libraries. Each Library has at least one assoicated Identity. Currently, there is no global registry of libraries. Discovery occurs by examining the social graph, by out-of-band sharing, or peer discovery on the network.

### Track
An audio file with its accompanying metadata form a Track. Tracks belong to a Library and are identified by their [audio fingerprint](https://acoustid.org/chromaprint). Two tracks in two different libraries with the same audio fingerprint will have the same id and will be treated as the same. In the future, the audio fingerprint can be used to determine the similarity of any two tracks.

### IPFS Peer
A computer running IPFS.

### Record Peer
A computer running the Record application or an instance of [record-node](https://github.com/mistakia/record-node). A peer can have many libraries. A record peer is also always an IPFS peer but not vice-versa.

## Guiding Principles
1. Distributed — self-contained and independent.
2. Open — free flow of information, permissionless, community governed.
3.
