# Matrix Abacus website media

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
