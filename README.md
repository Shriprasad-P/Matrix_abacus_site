# Matrix Abacus website and media

The Student and Admin portal source remains in `app/` for later use, but it is not published on the public website.

The website runs on Netlify. Its gallery and public PDF downloads can be managed by uploading files to one dedicated Google Drive folder. The owner does not need to edit this repository after the one-time setup.

## One-time setup

1. Create a Google Drive folder **only for public website images and PDFs**. Do not put private student or payment records in it.
2. In Google Cloud, enable the Drive API and create a service account with a JSON key. Share the folder with the service account email as **Viewer**.
3. In the Netlify site's environment variables, set:
   - `DRIVE_MEDIA_FOLDER_ID`: the ID between `/folders/` and the next `?` in the folder URL.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the complete JSON key contents. Keep this secret; never put it in Git or Drive.
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

This setup does not require a paid VPS or Firebase billing for the current pilot. Existing local SQLite data is not migrated automatically; create or import production records through the Admin screens after the first successful deploy. Do not enable public Firestore rules.
