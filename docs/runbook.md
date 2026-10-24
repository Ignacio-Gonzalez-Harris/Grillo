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

Nothing to do yet: the meeting screen arrives with its own story.

## Own-time answering

Nothing to do yet: own-time answering arrives with its own story.

## PRD

Nothing to do yet: the PRD view arrives with its own story.

## Updates

Nothing to do yet: app updates arrive with their own story.

## Store

Grillo reads and writes its data through one store. Which one is picked when the app starts:

1. GitHub (the default): `npm run dev` with `GRILLO_STORE` unset. Until the two GitHub backend stories land,
   every store call answers "not implemented yet".
2. Made-up data in memory: set `GRILLO_STORE=memory` in the shell, then `npm run dev`. Nothing reaches
   GitHub, and the data is gone when the app closes, except the recent-projects list in the settings file.

With any other value of `GRILLO_STORE` the app opens no window, and the terminal names the two allowed
values. How the data lives in GitHub is pinned in `docs/store-layout.md`.
