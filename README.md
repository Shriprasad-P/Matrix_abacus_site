# Matrix Abacus website and media

The Student and Admin portal source remains in `app/` for the mobile application, but it is not published on the public website. Only an admin can add and approve a student; there is no student self-registration. Students enter the registered guardian phone number in both the login ID and password fields. Siblings sharing a phone number choose their student profile after entering it. Changing the registered number signs out that student's active sessions, and archiving a student blocks sign-in. A phone number is easy to guess or learn, so replace this password rule with a stronger sign-in method before enrolling real students at scale.

The website runs on Netlify. Its gallery and public PDF downloads can be managed by uploading files to one dedicated Google Drive folder. The owner does not need to edit this repository after the one-time setup.

## One-time setup

1. Create a Google Drive folder **only for public website images and PDFs**. Do not put private student or payment records in it.
2. In Google Cloud, enable the Drive API. Share the folder with the service account email as **Viewer**. The existing Firebase Admin service account can be reused for this if it is already configured on Netlify; otherwise create a dedicated Google service account with a JSON key.
3. In the Netlify site's environment variables, set:
   - `DRIVE_MEDIA_FOLDER_ID`: the ID between `/folders/` and the next `?` in the folder URL.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: optional when `FIREBASE_SERVICE_ACCOUNT_JSON` is already configured. If using a dedicated Google service account, set this to its complete JSON key. Keep keys secret; never put them in Git or Drive.
4. Publish the site, then wait for the daily sync at **09:30 India time** (04:00 UTC). The first sync publishes up to six images. Netlify Functions and Blobs must be enabled on the site.

Until these settings are present, the existing images and PDFs continue to appear. The full gallery uses the same published image list as the homepage.

## Owner workflow

- Upload JPG, PNG, WebP, GIF or AVIF images, or PDF documents, directly into that folder. Files must be 20 MB or smaller.
- Images enter a queue in upload order. The site publishes **up to six new images every seven days**. With 500 images, the first six show after the first daily sync; the rest stay queued and release six at a time each week. Removing an image from Drive removes it from the site on the next daily sync.
- PDFs appear in **Downloads** on the next daily sync. Existing worksheet and results links are also replaced when an uploaded PDF has the matching name, such as `level1.pdf`, `prodigy.pdf`, or `student-results.pdf`.
- Upload only material approved for public display. Anyone can view or download published files on the website.

The queue state lives in Netlify Blobs, so deployments do not reset it. If the folder ID changes, images from the old folder are removed at the next sync. Images from the new folder then follow the existing weekly release schedule.

## Firebase API setup

The Student and Admin app API runs as a Netlify Function and stores its data in the `matrix-abacus` Firebase project. Firestore rules are intentionally closed; the server function uses the Firebase Admin SDK, so database credentials are not exposed to browsers or mobile apps.

In the Netlify project, open **Project configuration → Environment variables** and add these values for **Production**:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete service-account JSON for `matrix-abacus`. Create it in Firebase Console → Project settings → Service accounts → Generate new private key. Keep it only in Netlify; never commit it or upload it to Drive.
- `ABACUS_ADMIN_PASSWORD`: a long, unique administrator password. Keep it only in Netlify.

Trigger a new deploy after saving the variables. The API is then available at `https://matrixabacus.com/api/*`; opening `https://matrixabacus.com/api/me` while signed out should return JSON `401`, confirming the function is present. The mobile build can use `ABACUS_API_URL=https://matrixabacus.com`.

## Private lesson videos

1. In the institute's Google Drive, create a **separate private folder** for lesson videos. Inside it, create exactly four subfolders named `Beginner`, `Level 1`, `Level 2`, and `Level 3`. Keep link sharing restricted; do not use the public website media folder.
2. Share the parent folder as **Viewer** with the service account named in `GOOGLE_SERVICE_ACCOUNT_JSON`, or the one in `FIREBASE_SERVICE_ACCOUNT_JSON` when a dedicated Google key is not set. Upload MP4 videos encoded with H.264 video and AAC audio for iOS and Android playback into the matching level subfolder. Keep each file below 2 GB. Each video should have a detectable duration and be at least 30 seconds long so its completion can be recorded.
3. In Netlify, set `DRIVE_LESSON_VIDEO_FOLDER_ID` for **Production** to the ID in the private folder URL. Keep the existing service account variable available to Functions, then redeploy.

The owner adds or removes lessons by changing files in the level subfolders; video titles come from filenames. In the Admin app, set a separate price and UPI/bank instructions for each level. A student submits a payment reference for a level; the admin checks the bank/UPI statement and approves it. Approval unlocks streaming for **two calendar months**, starting at approval. An early renewal adds two months to the existing expiry. Tuition fees remain separate. Pending, rejected, and expired video purchases do not unlock lessons. The API checks the purchased level again for each playback request, and the video URL expires after two hours. The app streams; it does not save offline copies. The site uses short byte-range streams so large files stay within Netlify's per-response limit. There is no public Drive link in the app.

When a student finishes a video, the app records its completion after playback has run for at least 90% of the video's reported duration. Once every current video in that level is marked watched, the student can start a separate five-question final test. Every answer must be correct within the level's existing per-question time limit. Passing creates a permanent certificate record shown in the student profile; the certificate can be viewed as an SVG image. Ordinary practice still uses the existing five-correct timed streak to advance learning level. Changing the lesson list can require a student to watch newly added videos before starting the test. A student can renew an expired level even after advancing to a later level.

Playback controls and timing are access controls, not DRM or a proctored exam. A determined user can copy media or manipulate client behavior; treat the certificate as an institute learning record, not an independently verified qualification.

This setup does not require a paid VPS or Firebase billing for the current pilot. Existing local SQLite data is not migrated automatically; create or import production records through the Admin screens after the first successful deploy. Do not enable public Firestore rules.
