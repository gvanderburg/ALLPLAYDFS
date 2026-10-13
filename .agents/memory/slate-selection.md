---
name: Daily slate selection
description: Automatic next-slate intent and ESPN calendar/date constraints.
---

When a sport has no games today, ALLPLAY should show its next published game day and explain the date change.

**Why:** The user explicitly requested advancing to the next slate instead of leaving today's slate empty.

**How to apply:** Keep advancement sport-specific. Preserve deliberately selected historical dates; selecting today resumes automatic discovery. Keep schedule, salary lookup and projection context on the same resolved date. Never invent upcoming games when a schedule is unpublished.

Use published league calendars rather than assuming ESPN supports date-range queries uniformly.

**Why:** NFL date-range requests returned HTTP 400; football's published week calendars work instead. NASCAR calendars list individual race events, unlike football's grouped periods.

**How to apply:** Respect each provider calendar format when extending discovery. Verify real HTTP responses, not just unit fixtures.

Do not derive a slate date by slicing an event's UTC timestamp.

**Why:** A Thursday evening NFL game has a Friday UTC timestamp. ESPN slate discovery and DraftKings start-date filtering need a consistent Eastern calendar day.

**How to apply:** Translate event times to the slate's calendar timezone when choosing its day, while leaving actual start timestamps intact.
