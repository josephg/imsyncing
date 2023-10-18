# ImSyncing

This is a dead simple local first database built on top of CRDTs currently written in typescript.

I'm doing this as a fun hobby project - a beachhead for how I want my personal computing to work. This project *may* grow into something bigger & for more people over time, but I'm not making any promises.

Why typescript? Because I can personally prototype faster in TS than any other language. If imsyncing survives long enough, I'll end up rewriting it in rust or zig or something fun. But for now, this is it.


## The dream of personal computing

I dream of a "cloud of personal computing". I have a whole lot of devices, but I'm furious how difficult it is to move data from one computer (or phone) to another. Nothing is made to work together!

Imsyncing is part of my answer to this problem. The idea is that a lot of personal data / information can live in little documents in imsyncing and get synced to all the devices on the network which care about that particular data.

This is a local first database. When you are online, data is synced in realtime. When you go offline, you can still read / modify any local data but you don't get or propagate changes to other peers. When you come online again, everything syncs up.

My plan is to prototype out some fun apps on top of this like:

- Interacting with lego creations from any device
- Storing & managing my personal blog
- Controlling the lights in my home
- Managing & monitoring whats running on my servers
- Running a personal wiki / knowledge base

And whatever other dumb things I get up to.


## Architecture

This would be better described with a picture but -

The basic idea is that each device can run an imsyncing node which syncs with other devices on the network / internet.

Then specific applications running locally can sync with that, and use it to store their application specific data.

I'm not sure how I'll get that to work on an iphone yet. Haven't figured that out.


## Data model

The database stores a flat set of documents. Each document is named with a random globally unique name, and has:

- An (immutable) type field specifying what type of document it is. (Eg `post`, `midiDeviceStatus`, `imageGallery`, etc). This is sort of like a mime-type.
- Data! The data is a tree of CRDT objects. At the time of writing I only have support for registers and maps, but the plan is to add support for counters, sequences, text, and all the other goodies that a good CRDT library supports.

Because the database is built first and foremost for my own personal data, its not built super efficiently. It works fine for a modest collection of documents, but it is not optimized for a giant data set.


## Its a database

Everything gets persisted locally to disk. There are no smarts about how I'm doing that. Just, when changes happen, we rate limit saves to disk every 200ms or so.


## Weird choice: Using schemaboi

I'm using this project to exercise my own serialization library [schemaboi](https://github.com/josephg/schemaboi/). Schemaboi (SB) is built around the dream that we can have a serialization format that has a very efficient binary representation while also being able to evolve over time in more complex ways than protobuf. Time will tell if that works out in practice. But for now, both the net protocol and the on-disk file format use SB for serialization.


# What works, what doesn't work

Here's a rough list of what works and doesn't work. I make no promises that this list is kept up to date:

**Works:**

- Storage
- Simple net protocol
- Data model with documents
- Maps, registers
- Updates, online and offline syncing

**To do:**

- Peer discovery over DNS-SD
- And ideally bluetooth. It'd be cool if I can also sync over bluetooth.
- Authentication & security - currently everything is unauthenticated and unencrypted.
  - I'll probably add a simple PSK system for now to the network protocol.
- Web version
  - And once I can use it from the web, I want a simple web UI dashboard thing that I can use to see & interact with the data.
- Presence. I want a special document where each peer publishes its status and the set of peers its connected to, so we can draw a live graph showing the network state
- Delete map fields. Currently you can't delete fields.
- Build something fun on top of it
  - LEGO?
- Stored operations. Currently we don't store history. I want to optionally allow that.
  - Then with history documents can have git style branches
- Integrate diamond types to add text editing support
- Local process API. Generally need a way for local processes to use imsyncing without running their own node
- Rewrite the core stuff in rust or zig.
  - I'll keep the JS version for the web, but a native version would be awfully convenient for a bunch of use cases, like native iOS apps
- Allow peers to have a filtered view of the world, and only sync data with a small set of types

