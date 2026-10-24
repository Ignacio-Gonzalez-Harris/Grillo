# Grillo run-book

How to use each part of Grillo, one section per feature. Each feature's story edits only its own section.

## Setup

Nothing to do yet: the setup check arrives with its own story.

## Projects

Nothing to do yet: project creation and invitations arrive with their own story.

## Map and tickets

Nothing to do yet: the map and its tickets arrive with their own story.

## Agents

Nothing to do yet: agent tabs arrive with their own story.

## Meeting

The meeting screen arrives with its own story. What already works underneath it:

### Speech model (local transcription)

- Speech turns into text on the host's laptop with whisper.cpp and its `base.en` model; no audio or text leaves the
  machine for transcription.
- The model (about 148 MB) is downloaded once, on first use, from its public home on Hugging Face into the app data
  folder: `%APPDATA%\Grillo\models\ggml-base.en.bin` on Windows, `~/Library/Application Support/Grillo/models/` on
  a Mac. Its size and SHA-256 checksum are checked; a damaged or cut-short file is downloaded again.
- Model updates follow the `speechModelUpdates` value in the app data folder's `settings.json`: `automatic` (download
  a newer model straight away), `ask` (the default: ask first) or `never` (no check at all, not even a network call).
  The toggle for it arrives with the setup check screen.
- Developers: the real-transcription smoke test (`*.model.test.ts`) joins `npm test` only on a machine where that
  model file exists; delete the file to leave it out again.

## Own-time answering

Nothing to do yet: own-time answering arrives with its own story.

## PRD

Nothing to do yet: the PRD view arrives with its own story.

## Updates

Nothing to do yet: app updates arrive with their own story.
