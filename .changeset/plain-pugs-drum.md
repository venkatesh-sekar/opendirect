---
"@opendirect/desktop": minor
---

Restarting OpenDirect no longer submits runs that were still queued when it quit
— they wait in the job list with an explicit Resume. Only one copy of the app can
run at a time, the renderer process is fully sandboxed, development gets a
Content-Security-Policy of its own, "Open" is limited to the media types the app
recognises, and the AI helpers now run with an allowlisted environment rather
than a denylist of credential-shaped names.
