# Markets & Algos – Android app

Minimal offline app showing every lesson, the toolkit guide, all code and sample charts.

**Install:** download [`MarketsAndAlgos.apk`](MarketsAndAlgos.apk) on your phone → open it → allow "install unknown apps" when asked.

**Rebuild** (after changing lessons or code):
```bash
pip install markdown pygments
python app/build_site.py            # add --charts to regenerate sample charts
app/android/build_apk.sh            # needs JDK 17+ and Android SDK (platform 34, build-tools 34.0.0)
```
The signing key is created in `app/android/keystore/` (not committed). Keep it: Android only installs updates signed with the same key.
