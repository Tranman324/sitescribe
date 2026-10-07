'use strict';

/**
 * upload/validator — shape checks on parsed form data before we stage files.
 * Pure functions; no I/O.
 */

const fs = require('fs');
const config = require('../config');

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

function validateSenderEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new ValidationError('Missing or invalid sender_email');
  }
  const normalized = email.trim().toLowerCase();
  // Basic format check — no domain restriction. Token auth is the real gate.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ValidationError('Invalid email format');
  }
  return normalized;
}

function validateSenderName(name) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('Missing or invalid sender_name');
  }
  return name.trim();
}

const MAX_AUDIO_BYTES = 150 * 1024 * 1024; // 150 MB hard cap at HTTP layer

function validateAudio(audio) {
  if (!audio || !audio.path) {
    throw new ValidationError('Missing audio file');
  }
  let size = 0;
  try {
    size = fs.statSync(audio.path).size;
  } catch {
    throw new ValidationError('Audio file not stageable');
  }
  if (size === 0) {
    throw new ValidationError('Audio file empty');
  }
  if (size > MAX_AUDIO_BYTES) {
    throw new ValidationError(`Audio file too large: ${Math.round(size / 1024 / 1024)} MB (max 150 MB)`);
  }
  return audio;
}

function validatePhotoCount(photos) {
  if (photos.length > config.maxPhotos) {
    throw new ValidationError(`Too many photos: ${photos.length} (max ${config.maxPhotos})`);
  }
  return photos;
}

module.exports = {
  ValidationError,
  validateSenderEmail,
  validateSenderName,
  validateAudio,
  validatePhotoCount,
};
