// Configuration file for API keys and other sensitive information
// SECURITY NOTICE: Never hardcode API keys in source files

// Define type for our configuration
interface ApiConfig {
  GOOGLE_CLOUD_VISION_API_KEY: string;
  FIGMA_API_KEY: string;
}

// Create a safe config object without hardcoded secrets
export const API_CONFIG: ApiConfig = {
  // These will be populated at runtime
  GOOGLE_CLOUD_VISION_API_KEY: '',
  FIGMA_API_KEY: ''
};

/**
 * For Figma plugin development, you have a few options to handle API keys securely:
 * 
 * 1. Use a backend proxy server (recommended for production)
 * 2. For development/testing, store keys temporarily in localStorage
 *    and load them here (but never commit the actual keys)
 * 3. For Figma plugin, you can use plugin parameters
 */

// Example loading from localStorage (development only)
try {
  // Safe check if we're in a browser environment with localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    const cloudKey = window.localStorage.getItem('GOOGLE_CLOUD_VISION_API_KEY');
    const figmaKey = window.localStorage.getItem('FIGMA_API_KEY');
    
    if (cloudKey) API_CONFIG.GOOGLE_CLOUD_VISION_API_KEY = cloudKey;
    if (figmaKey) API_CONFIG.FIGMA_API_KEY = figmaKey;
  }
} catch (e) {
  console.warn('Unable to load API keys from storage', e);
}
