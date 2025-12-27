const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Reviews file path
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

// Initialize reviews file if it doesn't exist
function initReviewsFile() {
  if (!fs.existsSync(REVIEWS_FILE)) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify({ reviews: [] }, null, 2));
    console.log('📝 Reviews file created');
  }
}

// Read reviews from file
function readReviews() {
  try {
    const data = fs.readFileSync(REVIEWS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading reviews:', error);
    return { reviews: [] };
  }
}

// Write reviews to file
function writeReviews(data) {
  try {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing reviews:', error);
    return false;
  }
}

// Initialize reviews file
initReviewsFile();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// ==================== REVIEWS API ====================

// GET all reviews
app.get('/api/reviews', (req, res) => {
  try {
    const data = readReviews();
    res.json({ success: true, reviews: data.reviews });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});

// GET reviews for a specific location
app.get('/api/reviews/:locationName', (req, res) => {
  try {
    const data = readReviews();
    const locationName = decodeURIComponent(req.params.locationName);
    const locationReviews = data.reviews.filter(
      r => r.locationName.toLowerCase() === locationName.toLowerCase()
    );
    res.json({ success: true, reviews: locationReviews });
  } catch (error) {
    console.error('Error fetching location reviews:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});

// POST a new review
app.post('/api/reviews', async (req, res) => {
  try {
    const { locationName, locationAddress, reviewerName, reviewerEmail, rating, reviewText } = req.body;

    // Validate required fields
    if (!locationName || !reviewerName || !rating || !reviewText) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields'
      });
    }

    // Create new review object
    const newReview = {
      id: Date.now().toString(),
      locationName,
      locationAddress: locationAddress || '',
      author: reviewerName,
      email: reviewerEmail || '',
      rating: parseInt(rating),
      text: reviewText,
      createdAt: new Date().toISOString()
    };

    // Read existing reviews and add new one
    const data = readReviews();
    data.reviews.push(newReview);

    // Save to file
    if (!writeReviews(data)) {
      throw new Error('Failed to save review');
    }

    console.log(`⭐ New review added for ${locationName} by ${reviewerName} (${rating} stars)`);

    // Send email notification about new review
    try {
      const mailOptions = {
        from: `"Matrix Abacus Reviews" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_TO,
        replyTo: reviewerEmail || process.env.EMAIL_USER,
        subject: `New Review: ${locationName} - ${rating} Stars`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">⭐ New Review Submitted</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold; width: 30%;">Location:</td>
                <td style="padding: 10px; background: #f9fafb;">${locationName}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Address:</td>
                <td style="padding: 10px; background: #f9fafb;">${locationAddress || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Reviewer:</td>
                <td style="padding: 10px; background: #f9fafb;">${reviewerName}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Email:</td>
                <td style="padding: 10px; background: #f9fafb;">${reviewerEmail || 'Not provided'}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Rating:</td>
                <td style="padding: 10px; background: #f9fafb; color: #f59e0b; font-size: 18px;">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f3f4f6; font-weight: bold; vertical-align: top;">Review:</td>
                <td style="padding: 10px; background: #f9fafb;">${reviewText}</td>
              </tr>
            </table>
            
            <p style="margin-top: 20px; color: #6b7280; font-size: 12px;">
              This review was submitted via the Matrix Abacus website.
            </p>
          </div>
        `
      };
      await transporter.sendMail(mailOptions);
      console.log('📧 Review notification email sent');
    } catch (emailError) {
      console.error('Failed to send review email notification:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully!',
      review: newReview
    });

  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit review. Please try again.'
    });
  }
});

// ==================== CONTACT API ====================

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, course, message } = req.body;

    // Validate required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields (name, email, phone)'
      });
    }

    // Email content
    const mailOptions = {
      from: `"Matrix Abacus Website" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      replyTo: email,
      subject: `New Contact Form Submission - ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">New Contact Form Submission</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
              <td style="padding: 10px; background: #f3f4f6; font-weight: bold; width: 30%;">Name:</td>
              <td style="padding: 10px; background: #f9fafb;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Email:</td>
              <td style="padding: 10px; background: #f9fafb;"><a href="mailto:${email}">${email}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Phone:</td>
              <td style="padding: 10px; background: #f9fafb;"><a href="tel:${phone}">${phone}</a></td>
            </tr>
            ${course ? `
            <tr>
              <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Course Interest:</td>
              <td style="padding: 10px; background: #f9fafb;">${course}</td>
            </tr>
            ` : ''}
            ${message ? `
            <tr>
              <td style="padding: 10px; background: #f3f4f6; font-weight: bold; vertical-align: top;">Message:</td>
              <td style="padding: 10px; background: #f9fafb;">${message}</td>
            </tr>
            ` : ''}
          </table>
          
          <p style="margin-top: 20px; color: #6b7280; font-size: 12px;">
            This email was sent from the Matrix Abacus website contact form.
          </p>
        </div>
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent successfully for ${name} (${email})`);

    res.status(200).json({
      success: true,
      message: 'Thank you! Your message has been sent successfully.'
    });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again or contact us directly.'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
