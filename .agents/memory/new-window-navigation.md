---
name: New-window navigation
description: Preserve native browser behavior for links intended to open separate windows or tabs.
---

Use native anchors, with artifact-prefixed URLs and `target="_blank"` / `rel="noopener noreferrer"`, for new-window navigation.

**Why:** The installed client router's Link handler intercepts ordinary left clicks and navigates internally without checking the target attribute. Merely adding a blank target to that component did not ensure a separate news window.

**How to apply:** Keep router links for in-place navigation. For a requested separate tab/window, use a native anchor and verify that no click handler prevents its default browser behavior. Recheck the library implementation if replacing this convention.
