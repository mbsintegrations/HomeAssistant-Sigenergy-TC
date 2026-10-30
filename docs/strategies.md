# Personal strategies, tariffs and forecasts

## Rule scheduling

Open **Personal Strategies → Scheduling**. Save the master switch off while editing. Add named rules with weekdays, start/end time, optional battery SOC condition, action, priority and optional battery power limit. An enabled solar-export rule requires an explicit export power limit and site export approval. Then deliberately enable **Run personal strategies**.

Rules are stored per integration entry in HA, not uploaded as native TOU schedules. They use HA's configured time zone. A period ending before its start continues the following morning and belongs to the selected **start day**. `08:00–01:00` therefore means 8 am through 1 am next morning. SOC above/below tests are strict; at exactly the threshold they do not match.

The scheduler evaluates every 30 seconds without cloud traffic while idle, master-disabled or control-disabled. Highest numeric priority wins. Two matching rules tied at highest priority report a configuration error rather than choose unpredictably. Unknown SOC cannot trigger a rule.

Matching battery rules use bounded native leases of up to 15 minutes, shortened to the remaining window and renewed only while conditions remain valid. The backend revalidates fresh SOC/power and applies stricter native SOC bounds. Very short remaining windows may be rejected if cloud delay leaves less than one full minute. A rule must not be relied on for sub-minute precision.

**Manual owner control has priority.** Timed owner overrides suppress scheduled dispatch. Permanent TC owner setting changes or detected superseding native changes pause scheduling durably. To resume, review the plant, open Scheduling and deliberately save its enabled master switch again. A delayed earlier resume does not clear a newer owner pause.

**Allow solar export** holds the battery, blocks battery export and applies an owner export cap inside the installer ceiling. It is an HA-dependent policy, not a new native conditional TOU feature. Its auxiliary settings need safe restoration; see [recovery](controls-and-recovery.md). **Discharge to Grid** is a different action and permits battery export. Neither bypasses site approval.

## Tariffs

Buying and selling plans are separate. Use a flat price or weekly timetable; add periods only as needed. The editor validates price, day/time coverage and overlaps. Seasons can select different date ranges. Choose currency, cents versus major units and time zone carefully: EUR0.09/kWh equals 9 cents/kWh, not EUR9/kWh. Midnight periods use their start weekday. Negative prices are supported where the tariff permits them.

Saved tariffs drive displayed price history and planning inputs. They are local preferences; saving a tariff does not alter the supplier contract or upload a native Sigen TOU plan. Personal strategies run their explicit conditions rather than silently infer a financial objective from tariffs.

## Advisory planner

`preview_plan` combines an explicit 24-hour demand estimate, configured tariffs and complete forecast coverage to produce a charging recommendation. It does not execute an autonomous financial optimizer. Missing/stale/incomplete forecast data makes the recommendation unavailable instead of assuming zero solar. AI provider execution is not implemented in 0.2.0.

## Forecasts

Select one provider or average two cached providers covering the same panels. Avoid averaging individual strings and a whole-system forecast, or counting an aggregate twice. Provider badges reflect sources that actually contributed valid values; a missing source remains selected in settings but is excluded from an affected total. Correct location, orientation, tilt and kWp are essential. Provider service quotas and forecast uncertainty remain relevant even when HA can calculate an average cheaply.
