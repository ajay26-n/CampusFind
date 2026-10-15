/**
 * CampusFind Authentication Constants & Validation Helpers
 * Configured specifically for Builders College.
 */

export const COLLEGE_EMAIL_DOMAIN = 'builderscollege.edu.in';
export const CENTRAL_ADMIN_EMAIL = 'ajay.cs23@builderscollege.edu.in';

export interface EmailValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates that an email address is syntactically valid and ends with the official college domain.
 * Example valid: rollnumber@builderscollege.edu.in, john.doe@builderscollege.edu.in
 */
export function validateCollegeEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed) {
    return {
      isValid: false,
      error: 'College email is required.',
    };
  }

  // Standard email format verification
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return {
      isValid: false,
      error: 'Please enter a valid email format.',
    };
  }

  // Domain verification
  const parts = trimmed.split('@');
  if (parts.length !== 2 || parts[1] !== COLLEGE_EMAIL_DOMAIN) {
    return {
      isValid: false,
      error: `Only @${COLLEGE_EMAIL_DOMAIN} email addresses are allowed.`,
    };
  }

  return { isValid: true };
}
