---
name: ALLPLAY independent projection model
description: The product must calculate its own player stat forecasts from historical performance and upcoming matchups.
---

ALLPLAY's matchup projections must use its own algorithm, not relabel published DraftKings, FanDuel or ESPN forecasts as ALLPLAY predictions. The user wants previous performances compared with opponent rankings to estimate each player's stats on the upcoming slate, separately by sport.

**Why:** The user explicitly rejected using either platform's projections and clarified that they need their own algorithm for each player.

**How to apply:** Distinguish historical source data from model-generated forecasts. Show meaningful sport-specific stat estimates and relevant matchup inputs; do not substitute an external fantasy-point forecast or imply that choosing a fantasy scoring system supplies a projection model. Keep missing inputs explicit and label any model estimates honestly. NASCAR requires race/track-specific modelling rather than a fictional opposing-team defense.

Published DFS-site scoring rules are allowed to convert ALLPLAY's own stat forecasts into fantasy points. Uploaded projection spreadsheets are reference formats, not sources of third-party forecasts, contest ownership, or percentile values to relabel.

**Why:** On 2026-10-13 the user explicitly selected each site's scoring rules after clarifying that the forecast algorithm itself must be ALLPLAY's own.

**How to apply:** Separate statistical forecasts from scoring coefficients. Distinguish modeled outcome percentiles from confidence intervals, and unavailable contest/lineup inputs from observed zeros. Do not label partial scoring subtotals as complete fantasy points or compute salary value from them.

ALLPLAY must turn its independent history/matchup forecasts into actionable DFS research: fantasy-score estimates, reasons to consider a player, and clearly labeled ownership estimates where supportable. A formatted statistics table alone does not meet the product goal.

**Why:** On 2026-10-13 the user clarified that they need suggestions for upcoming games/slates, not merely raw statistical projections.

**How to apply:** Separate full fantasy scores from incomplete inputs. Ownership inferred without contest ownership history is an uncalibrated selection-share heuristic, not observed or validated contest ownership. Label its assumptions and supported slate/pool restrictions; never fill unsupported estimates with provider values or fabricated percentages.

Opponent and defensive-unit power rankings should use published sources, not an ALLPLAY-generated replacement.

**Why:** The user explicitly chose published power rankings for position-specific matchup research. This does not replace the requirement for ALLPLAY's own player forecasts.

**How to apply:** Identify the publisher, rating scope and publication period. Keep published power ratings separate from ALLPLAY's observed-stat matchup ranks. Do not present preseason ratings as weekly updates, or fill missing published ratings with unlabeled internal estimates.

For NFL matchup context, the user selected both PFF secondary strength and FantasyPros defense-versus-position ratings.

**Why:** They want both defensive-unit quality and position-specific matchup information, while retaining independent ALLPLAY player forecasts.

**How to apply:** Keep the two ratings separately labeled and dated. Public preview coverage is not permission to retrieve gated report rows. Do not invent an ordinal-rank-to-stat adjustment: incorporating published ratings into numerical forecasts requires an explicit, tested mapping rather than an arbitrary bonus.

Uploaded projection sheets are diagnostic benchmarks, not completed-game labels. Normalize the scoring site and roster-slot multiplier before comparing forecasts.

**Why:** The user's FanDuel Showdown reference had 1.5× headline projections but separate base `fd_points`, and all future-game “Actual” entries were zero. Comparing unlike slots or treating those placeholders as outcomes would corrupt calibration.

**How to apply:** Compare base-to-base (or apply the same explicit slot multiplier to both). Keep published projections and ownership separate from verified final-game results. The user wants forecasts to keep incorporating real completed games from 2026-10-13 onward; forward updates are required, but improved accuracy must be demonstrated against actual subsequent results, not similarity to another forecaster.

Recheck official contest scoring rather than assuming older FanDuel conventions.

**Why:** FanDuel's official rules, verified on 2026-10-13 at https://www.fanduel.com/rules, list NFL +3 bonuses for 300 passing yards and 100 rushing/receiving yards. Treating all such bonuses as DraftKings-only would incorrectly alter this model.

**How to apply:** Confirm the current sport and contest variant before changing coefficients or interpreting a reference sheet's points. Do not infer scoring rules solely from another provider's projection totals.
