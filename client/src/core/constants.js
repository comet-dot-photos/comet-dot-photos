// Constants used across modules in Comet.Photos

// Show Index choices
export const SI_NONE = "None", SI_UNMAPPED = "Unmapped 2D", SI_PERSPECTIVE = "Projected 3D"; // "Show Image" choices

// Skip Duration choices
export const SD_DAY = "Day", SD_MONTH = "Month", SD_YEAR = "Year";

// Log Level choices
export const LL_REGRESSION = '1: Regression Test', LL_TERSE = '2: Terse', LL_VERBOSE = '3: Verbose';

// Color constants used by multiple modules
export const PAINT_RED = 241, PAINT_GREEN = 178, PAINT_BLUE = 171;	  // color of painted region
export const COMETGREYVAL = 255;
export const COMETCOLOR = COMETGREYVAL<<16 | COMETGREYVAL<<8 | COMETGREYVAL;

//  Brush Radius
export const BR_MIN = 1, BR_MAX = 200;
