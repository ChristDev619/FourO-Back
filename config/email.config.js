require('dotenv').config();

/**
 * Email Configuration
 * Centralized email settings for Azure Communication Services
 */
module.exports = {
  // Azure Communication Services Configuration
  azure: {
    connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
    senderEmail: process.env.AZURE_COMMUNICATION_SENDER_EMAIL || 'noreply@yourdomain.com',
  },

  // Email Sender Information
  from: {
    email: process.env.EMAIL_FROM_EMAIL || process.env.AZURE_COMMUNICATION_SENDER_EMAIL,
    name: process.env.EMAIL_FROM_NAME || 'FourO Platform',
  },

  // Frontend URL for email links (using existing FRONTEND_ORIGIN from ACI)
  frontendUrl: process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000',

  // Token Expiration Settings
  verification: {
    expiresInHours: parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS) || 24,
  },

  passwordReset: {
    expiresInHours: parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS) || 1,
  },

  // Rate Limiting Settings
  rateLimits: {
    passwordResetPerHour: 3,
    verificationEmailPerHour: 5,
  },

  // Email Templates Configuration
  templates: {
    welcomeSubject: 'Welcome to FourO - Verify Your Email',
    resetPasswordSubject: 'Reset Your FourO Password',
    passwordChangedSubject: 'Your FourO Password Was Changed',
    verificationSubject: 'Verify Your FourO Email Address',
  },

  // Retry Configuration for Failed Emails
  retry: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialDelayMs: 1000,
  },

  // Feature Flags
  features: {
    enableEmailVerification: process.env.ENABLE_EMAIL_VERIFICATION !== 'false', // Default: true
    requireVerifiedEmail: process.env.REQUIRE_VERIFIED_EMAIL === 'true', // Default: false for backward compatibility
    sendWelcomeEmail: process.env.SEND_WELCOME_EMAIL !== 'false', // Default: true
  },

  // Azure Application Insights Integration
  logging: {
    logEmailSends: true,
    logEmailFailures: true,
  },
};

