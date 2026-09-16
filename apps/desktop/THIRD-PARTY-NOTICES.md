# Third-party notices

OpenDirect itself is MIT licensed — see `LICENSE` at the root of the
repository. This file records the third-party components distributed **inside
the installers** whose licences ask for more than the copy of the licence text
that already ships beside them in `node_modules`.

It is copied next to `app.asar` in the packaged app (`extraResources` in
`apps/desktop/electron-builder.yml`), so every installed copy carries it.

Add an entry here whenever a dependency arrives under a copyleft, weak-copyleft
or otherwise attribution-requiring licence. Permissive dependencies (MIT, ISC,
BSD, Apache-2.0) are satisfied by the licence files that ship with them.

---

## elkjs 0.12.0

- **Copyright** © Kiel University and others.
- **Licence:** `EPL-2.0 OR GPL-3.0-or-later`. OpenDirect takes it under the
  **Eclipse Public License 2.0**.
- **Licence text:** <https://www.eclipse.org/legal/epl-2.0/>
- **Source:** <https://github.com/kieler/elkjs> (npm package `elkjs`,
  version 0.12.0)

elkjs is used **unmodified**, as an ordinary runtime dependency, by
`apps/desktop/src/main/canvas-migrate.ts` — it computes the layered layout that
places an existing project's lineage on the canvas the first time that project
is migrated.

The EPL-2.0 is file-level copyleft. Because elkjs is consumed as a separate,
unmodified module, the obligation is attribution and source availability **for
elkjs itself**, not for OpenDirect. The source above is the corresponding
source for the version shipped; no modifications have been made to it.

elkjs bundles the layout algorithms from the Eclipse Layout Kernel, transpiled
from Java, under the same terms.
