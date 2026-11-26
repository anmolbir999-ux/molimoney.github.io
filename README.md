# Moli — a quiet finance guide (Android)

A minimalist, animated Android app that tracks what you earn and spend and tells you where you could save.

**Install:** download [`Moli.apk`](Moli.apk) on your phone, open it, and allow "install unknown apps" when asked.

| Home | Guide | Activity | Welcome |
|---|---|---|---|
| ![](docs/home.png) | ![](docs/guide.png) | ![](docs/activity.png) | ![](docs/welcome.png) |

## What it does
- **Log income & expenses** in a bottom sheet (tap +). Tap any transaction to edit or delete it.
- **Minimal charts:** cumulative spending line (this month vs last), category ring, 6‑month bars, needs/wants/saved split bar — all drawn by hand and animated in.
- **Guide:** a rule-based advisor (`app/src/main/java/com/molimoney/app/logic/Advisor.kt`) that compares your typical month (avg of last 3) with this month and suggests sized actions:
  - categories running hot vs usual
  - 50/30/20 check (wants over 30%, needs over 55%)
  - recurring subscriptions found from repeating charges
  - many small purchases adding up
  - weekend vs weekday spending
  - a monthly cap for your biggest "want"
  - this month's pace → a safe daily spend for the rest of the month
  - savings rate vs your goal, and a 3‑month safety net plan
- Everything is stored only on the phone. No account, no internet permission.

## Build
JDK 17+ and Android SDK 35: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.
Or run the **Build APK** GitHub Action and download the artifact.
Screenshot tests (Robolectric + Roborazzi): `./gradlew testDebugUnitTest` → `app/screenshots/`.
