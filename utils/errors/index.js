/**
 * Error Classes Export
 * 
 * Centralized export point for all custom error classes.
 * This follows the Single Responsibility Principle and provides
 * a clean API for importing errors throughout the application.
 */

const BaseError = require('./BaseError');
const JobNotFoundError = require('./JobNotFoundError');

module.exports = {
  BaseError,
  JobNotFoundError
};

