/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// SSOF Planning System types
export type WeightCategory = '50g' | '250g' | '1kg';

export const WEIGHT_OPTIONS: WeightCategory[] = ['50g', '250g', '1kg'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
