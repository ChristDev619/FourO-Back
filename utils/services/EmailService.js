const { EmailClient } = require('@azure/communication-email');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const emailConfig = require('../../config/email.config');
const logger = require('../logger');
const appInsights = require('../azureInsights');

/**
 * EmailService - Handles all email operations using Azure Communication Services
 * Designed to be reusable for auth emails and future notification center
 */
class EmailService {
  constructor() {
    this.client = null;
    this.isConfigured = false;
    this.templateCache = new Map();
    this.initializeClient();
  }

  /**
   * Initialize Azure Communication Email Client
   */
  initializeClient() {
    try {
      if (!emailConfig.azure.connectionString) {
        logger.warn('Azure Communication Services connection string not configured. Email functionality will be disabled.');
        this.isConfigured = false;
        return;
      }

      this.client = new EmailClient(emailConfig.azure.connectionString);
      this.isConfigured = true;
      logger.info('Azure Communication Email Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Azure Communication Email Service', {
        error: error.message,
        stack: error.stack,
      });
      this.isConfigured = false;
    }
  }

  /**
   * Check if email service is properly configured
   */
  isReady() {
    return this.isConfigured && this.client !== null;
  }

  /**
   * Generate secure token for email verification or password reset
   */
  generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash token before storing in database (security best practice)
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Load and cache email template
   */
  async loadTemplate(templateName) {
    try {
      // Check cache first
      if (this.templateCache.has(templateName)) {
        return this.templateCache.get(templateName);
      }

      const templatePath = path.join(__dirname, '../../templates/email', `${templateName}.html`);
      const template = await fs.readFile(templatePath, 'utf-8');
      
      // Cache the template
      this.templateCache.set(templateName, template);
      
      return template;
    } catch (error) {
      logger.error(`Failed to load email template: ${templateName}`, {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Email template not found: ${templateName}`);
    }
  }

  /**
   * Replace placeholders in template
   */
  replacePlaceholders(template, data) {
    let result = template;
    Object.keys(data).forEach((key) => {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(placeholder, data[key] || '');
    });
    return result;
  }

  /**
   * Send email using Azure Communication Services
   */
  async sendEmail({ to, subject, htmlContent, textContent = null, metadata = {} }) {
    if (!this.isReady()) {
      logger.warn('Email service not configured. Skipping email send.', { to, subject });
      return { success: false, message: 'Email service not configured' };
    }

    const correlationId = metadata.correlationId || crypto.randomUUID();
    const startTime = Date.now();

    try {
      const emailMessage = {
        senderAddress: emailConfig.azure.senderEmail,
        content: {
          subject: subject,
          html: htmlContent,
          plainText: textContent || this.stripHtml(htmlContent),
        },
        recipients: {
          to: [{ address: to }],
        },
      };

      logger.info('Sending email via Azure Communication Services', {
        to,
        subject,
        correlationId,
        metadata,
      });

      const poller = await this.client.beginSend(emailMessage);
      const response = await poller.pollUntilDone();

      const duration = Date.now() - startTime;

      logger.info('Email sent successfully', {
        to,
        subject,
        messageId: response.id,
        status: response.status,
        duration,
        correlationId,
      });

      // Track in Application Insights
      if (appInsights && emailConfig.logging.logEmailSends) {
        appInsights.defaultClient?.trackEvent({
          name: 'EmailSent',
          properties: {
            to,
            subject,
            messageId: response.id,
            status: response.status,
            correlationId,
            ...metadata,
          },
          measurements: {
            duration,
          },
        });
      }

      return {
        success: true,
        messageId: response.id,
        status: response.status,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to send email', {
        to,
        subject,
        error: error.message,
        stack: error.stack,
        duration,
        correlationId,
      });

      // Track failure in Application Insights
      if (appInsights && emailConfig.logging.logEmailFailures) {
        appInsights.defaultClient?.trackException({
          exception: error,
          properties: {
            to,
            subject,
            correlationId,
            ...metadata,
          },
        });
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Strip HTML tags for plain text version
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Send welcome email after user creation
   */
  async sendWelcomeEmail(user, verificationToken) {
    try {
      if (!emailConfig.features.sendWelcomeEmail) {
        logger.info('Welcome email disabled via config');
        return { success: true, message: 'Welcome email disabled' };
      }

      const verificationLink = `${emailConfig.frontendUrl}/verify-email?token=${verificationToken}`;
      
      const template = await this.loadTemplate('welcome');
      const htmlContent = this.replacePlaceholders(template, {
        firstName: user.firstName || user.username,
        lastName: user.lastName || '',
        username: user.username,
        verificationLink,
        expiresInHours: emailConfig.verification.expiresInHours,
        supportEmail: emailConfig.from.email,
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to: user.email,
        subject: emailConfig.templates.welcomeSubject,
        htmlContent,
        metadata: {
          type: 'welcome',
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      logger.error('Failed to send welcome email', {
        userId: user.id,
        email: user.email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send account activation email for new user invitations
   * This is for the new flow where users set their own password
   */
  async sendAccountActivationEmail(user, activationToken) {
    try {
      if (!emailConfig.features.sendWelcomeEmail) {
        logger.info('Account activation email disabled via config');
        return { success: true, message: 'Account activation email disabled' };
      }

      const activationLink = `${emailConfig.frontendUrl}/activate-account/${activationToken}`;
      
      const template = await this.loadTemplate('activateAccount');
      const htmlContent = this.replacePlaceholders(template, {
        firstName: user.firstName || user.username,
        lastName: user.lastName || '',
        username: user.username,
        activationLink,
        expiresInHours: emailConfig.verification.expiresInHours,
        supportEmail: emailConfig.from.email || 'support@fourosolutions.com',
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to: user.email,
        subject: 'Activate Your FourO Account',
        htmlContent,
        metadata: {
          type: 'account_activation',
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      logger.error('Failed to send account activation email', {
        userId: user.id,
        email: user.email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, resetToken) {
    try {
      const resetLink = `${emailConfig.frontendUrl}/reset-password/${resetToken}`;
      
      const template = await this.loadTemplate('resetPassword');
      const htmlContent = this.replacePlaceholders(template, {
        firstName: user.firstName || user.username,
        username: user.username,
        resetLink,
        expiresInHours: emailConfig.passwordReset.expiresInHours,
        supportEmail: emailConfig.from.email,
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to: user.email,
        subject: emailConfig.templates.resetPasswordSubject,
        htmlContent,
        metadata: {
          type: 'password_reset',
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      logger.error('Failed to send password reset email', {
        userId: user.id,
        email: user.email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send password changed confirmation email
   */
  async sendPasswordChangedEmail(user) {
    try {
      const template = await this.loadTemplate('passwordChanged');
      const htmlContent = this.replacePlaceholders(template, {
        firstName: user.firstName || user.username,
        username: user.username,
        changedAt: new Date().toLocaleString(),
        supportEmail: emailConfig.from.email,
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to: user.email,
        subject: emailConfig.templates.passwordChangedSubject,
        htmlContent,
        metadata: {
          type: 'password_changed',
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      logger.error('Failed to send password changed email', {
        userId: user.id,
        email: user.email,
        error: error.message,
      });
      // Don't throw - this is a notification email
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email verification (resend)
   */
  async sendVerificationEmail(user, verificationToken) {
    try {
      const verificationLink = `${emailConfig.frontendUrl}/verify-email?token=${verificationToken}`;
      
      const template = await this.loadTemplate('verifyEmail');
      const htmlContent = this.replacePlaceholders(template, {
        firstName: user.firstName || user.username,
        username: user.username,
        verificationLink,
        expiresInHours: emailConfig.verification.expiresInHours,
        supportEmail: emailConfig.from.email,
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to: user.email,
        subject: emailConfig.templates.verificationSubject,
        htmlContent,
        metadata: {
          type: 'verification',
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      logger.error('Failed to send verification email', {
        userId: user.id,
        email: user.email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generic method to send custom email (for future notification center)
   */
  async sendCustomEmail({ to, subject, templateName, templateData, metadata = {} }) {
    try {
      const template = await this.loadTemplate(templateName);
      const htmlContent = this.replacePlaceholders(template, {
        ...templateData,
        supportEmail: emailConfig.from.email,
        currentYear: new Date().getFullYear(),
      });

      return await this.sendEmail({
        to,
        subject,
        htmlContent,
        metadata: {
          type: 'custom',
          templateName,
          ...metadata,
        },
      });
    } catch (error) {
      logger.error('Failed to send custom email', {
        to,
        templateName,
        error: error.message,
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();

