/** Standard success envelope used by the Zenflow API. */
export interface ApiSuccess<T> {
  success: true;
  message?: string;
  data: T;
}

/** Standard error envelope. */
export interface ApiError {
  success: false;
  message: string;
  statusCode?: number;
  /** Offending field name for validation errors. */
  field?: string;
}

/** 7×24 signed preference matrix for the Insights heatmap. */
export interface PreferenceMatrixResponse {
  /** Flat 168-element float row-major [day0..6][block0..23], signed scores.
   * Values are floats (not integers) because the daily exponential decay
   * accumulates sub-integer precision; the FE normalises them for colour. */
  matrix: number[];
  /** Grid dims so the FE doesn't hard-code them. */
  days: number; // 7
  blocks: number; // 24
}
