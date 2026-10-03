---
"@opendirect/desktop": patch
---

Retrying a failed or cancelled run whose input image has been deleted is now refused with an explanation, instead of sending the run without that input; the delete confirmation warns about this. Deleting an asset also removes the larger preview copies cached for it.
