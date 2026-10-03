---
"@opendirect/desktop": patch
---

Canvas fixes: after deleting a node, selecting a generate node brings the prompt bar back again; deleting a connected node is now a single undo step; and undo skips, with a short notice, a step whose asset has since been deleted instead of getting stuck on it. The "Add to…" dialog on a card no longer fails as soon as it opens.
