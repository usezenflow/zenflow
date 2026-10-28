export const DAILY_HORIZON = 24 * 60;
export const TIME_REGEX = /^(((0|1)[0-9])|(2[0-3])):([0-5][0-9])$/;
export const ORDER_GAP = 4096;
export const DAY_OF_WEEK = 7;
export const TIME_GRANULARITY = 15;

/** AES-256-GCM: 96-bit IV (NIST SP 800-38D recommended), 256-bit key. */
export const IV_RANDOM_BYTES_SIZE = 12;
export const KEY_RANDOM_BYTES_SIZE = 32;
export const ENCRYPTION_ALGORITHM = "aes-256-gcm";

/** Longest travel time kept clear around a session, each way. */
export const MAX_COMMUTE_MINUTES = 180;

/** Identifies Zenflow to DLU and the LMS. Never a browser string. */
export const UPSTREAM_USER_AGENT = "Zenflow/1.0 (+https://usezenflow.com)";
