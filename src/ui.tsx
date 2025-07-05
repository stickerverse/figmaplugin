import { h, JSX, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { emit } from './utilities';
import { ImageAnalysisResult } from './main';
import { API_CONFIG } from './config';
import { VisionApiService } from './services/vision-api-service';
import { FigmaApiService } from './services/figma-api-service';

// Declare our shared core functionality
declare global {
  interface Window {
    StickerCore: any;
    StickerUI: any;
  }
}

import './ui.css';

// Initialize our unified system
const initializeUnifiedSystem = () => {
  try {
    // Create a script element to load the core
    const coreScript = document.createElement('script');
    // Use relative path for Figma plugin environment
    coreScript.src = '../shared/core.js';
    coreScript.onload = () => {
      // Once core is loaded, load the UI system
      const uiScript = document.createElement('script');
      uiScript.src = '../shared/unified-ui.js';
      uiScript.onload = () => {
        // Once both are loaded, initialize and notify the plugin
        if (window.StickerCore && window.StickerUI) {
          window.StickerCore.CONFIG.initialize();
          window.StickerCore.Messenger.initialize();
          window.StickerUI.initialize(document.body);
          
          // Notify the plugin that core is initialized
          parent.postMessage({
            pluginMessage: {
              type: 'CORE_INITIALIZED',
              config: window.StickerCore.CONFIG
            }
          }, '*');
          
          console.log('Unified system initialized');
        }
      };
      document.head.appendChild(uiScript);
    };
    document.head.appendChild(coreScript);
  } catch (err) {
    console.error('Failed to initialize unified system:', err);
  }
};

function Plugin() {
  // State management
  const [apiKey, setApiKey] = useState<string>(API_CONFIG.GOOGLE_CLOUD_VISION_API_KEY || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'upload' | 'settings' | 'help'>('upload');
  const [importedJsonData, setImportedJsonData] = useState<any>(null);
  const [importMethod, setImportMethod] = useState<'image' | 'json'>('image');

  // Function to handle file selection
  const handleFileChange = (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const selectedFile = input.files[0];
      
      // Check if this is a JSON file
      if (selectedFile.name.toLowerCase().endsWith('.json')) {
        handleJsonFileImport(selectedFile);
        return;
      }
      
      // Handle image file
      setImageFile(selectedFile);
      setImportMethod('image');
      
      // Create image preview
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target) {
          setImagePreview(e.target.result as string);
        }
      };
      reader.readAsDataURL(selectedFile);
      
      // Clear any previous errors and JSON data
      setError(null);
      setImportedJsonData(null);
    }
  };
  
  // Function to handle JSON file import
  const handleJsonFileImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (e.target && e.target.result) {
          const jsonText = e.target.result.toString();
          const jsonData = JSON.parse(jsonText);
          
          // Validate the JSON structure
          if (jsonData.version && jsonData.imageAnalysis) {
            setImportedJsonData(jsonData);
            setImportMethod('json');
            setStatusMessage('JSON data loaded successfully. Click "Create Components" to proceed.');
            
            // If the JSON contains image data, show a preview
            if (jsonData.imageAnalysis.originalImage) {
              setImagePreview(`data:image/jpeg;base64,${jsonData.imageAnalysis.originalImage}`);
            }
          } else {
            setError('Invalid JSON format. Missing required data structure.');
          }
        }
      } catch (err: any) {
        console.error('JSON parse error:', err);
        setError(`Error parsing JSON: ${err.message}`);
      }
    };
    
    reader.onerror = () => {
      setError('Error reading the JSON file.');
    };
    
    reader.readAsText(file);
  };

  // Function to save API key
  const handleApiKeySave = () => {
    localStorage.setItem('googleVisionApiKey', apiKey);
    setStatusMessage('API Key saved successfully!');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // Load API key from local storage and check clipboard on component mount
  useEffect(() => {
    // Load API key
    const savedApiKey = localStorage.getItem('googleVisionApiKey');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
    
    // Check clipboard for component data
    checkClipboardForComponentData();
  }, []);
  
  // Handler for clicking the paste from clipboard button
  const handlePasteFromClipboard = async () => {
    try {
      setStatusMessage('Reading from clipboard...');
      
      // Check if clipboard API is available
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipboardText = await navigator.clipboard.readText();
        processClipboardText(clipboardText);
      } else {
        setError('Clipboard API not available. Please try manual paste.');
        showManualPasteOption();
      }
    } catch (err: any) {
      console.error('Clipboard access error:', err);
      setError(`Error accessing clipboard: ${err.message}. Try manual paste.`);
      showManualPasteOption();
    }
  };

  // Handle the create components button click
  const handleCreateComponents = () => {
    if (importMethod === 'image' && imageFile) {
      analyzeImage();
    } else if (importMethod === 'json' && importedJsonData) {
      analyzeImage();
    } else {
      setError('No valid image or component data available.');
    }
  };

  // Function to check clipboard for valid component data
  const checkClipboardForComponentData = async () => {
    try {
      setStatusMessage('Checking clipboard for component data...');
      
      // Check if clipboard API is available (only in secure contexts)
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const clipboardText = await navigator.clipboard.readText();
          processClipboardText(clipboardText);
        } catch (clipboardError) {
          console.error('Error reading from clipboard API:', clipboardError);
          setError('Could not access clipboard. Please try pasting manually into a text field.');
          // Show a text area for manual paste as fallback
          showManualPasteOption();
        }
      } else {
        console.warn('Clipboard API not available');
        setError('Clipboard API not available in this context. Please try pasting manually.');
        // Show a text area for manual paste as fallback
        showManualPasteOption();
      }
    } catch (err: any) {
      console.error('Clipboard check error:', err);
      setError(`Error checking clipboard: ${err.message}`);
    }
  };

  // Show manual paste option when clipboard API fails
  const showManualPasteOption = () => {
    // Create a textarea for manual JSON pasting
    const textAreaContainer = document.createElement('div');
    textAreaContainer.className = 'manual-paste-container';
    
    const label = document.createElement('label');
    label.textContent = 'Paste JSON data here:';
    
    const textArea = document.createElement('textarea');
    textArea.rows = 5;
    textArea.className = 'manual-paste-textarea';
    textArea.placeholder = 'Paste the component data JSON here...';
    
    const button = document.createElement('button');
    button.className = 'button primary';
    button.textContent = 'Process Pasted Data';
    button.onclick = () => {
      processClipboardText(textArea.value);
    };
    
    textAreaContainer.appendChild(label);
    textAreaContainer.appendChild(textArea);
    textAreaContainer.appendChild(button);
    
    // Find where to insert the manual paste option
    const targetElement = document.querySelector('.tab-content');
    if (targetElement) {
      targetElement.appendChild(textAreaContainer);
    }
  };

  // Process the clipboard text
  const processClipboardText = (text: string) => {
    if (!text || text.trim() === '') {
      setError('No data found in clipboard');
      return;
    }
    
    try {
      // Try to parse as JSON
      const clipboardData = JSON.parse(text);
      
      // Validate if this is component data from our extension
      if (clipboardData && 
          clipboardData.version && 
          clipboardData.imageAnalysis && 
          (clipboardData.imageAnalysis.colors || 
           clipboardData.imageAnalysis.typography || 
           clipboardData.imageAnalysis.components)) {
        
        setStatusMessage('Component data detected! Click "Create Components" to proceed.');
        setImportedJsonData(clipboardData);
        setImportMethod('json');
        setError('');
        
        // If the JSON contains image data, show a preview
        if (clipboardData.imageAnalysis.originalImage) {
          setImagePreview(`data:image/jpeg;base64,${clipboardData.imageAnalysis.originalImage}`);
        }
      } else {
        console.log('Not valid component data format');
        setError('The clipboard data is not in the expected format');
      }
    } catch (parseError) {
      // Not valid JSON in clipboard, that's okay
      console.log('No valid component data in clipboard');
      setError('No valid component data found in clipboard');
    }
  };

  // Initialize services
  const [visionService] = useState<VisionApiService>(
    new VisionApiService(API_CONFIG.GOOGLE_CLOUD_VISION_API_KEY)
  );
  const [figmaService] = useState<FigmaApiService>(
    new FigmaApiService(API_CONFIG.FIGMA_API_KEY)
  );

  // Listen for external messages from the Chrome extension
  useEffect(() => {
    // Initialize our unified system
    initializeUnifiedSystem();
    
    // Message handler for external messages
    const handleExternalMessage = (event: MessageEvent) => {
      if (event.data.pluginMessage && event.data.pluginMessage.type === 'EXTERNAL_DATA_RECEIVED') {
        console.log('UI received external data:', event.data.pluginMessage.data);
        
        // Process the imported data from Chrome extension
        const externalData = event.data.pluginMessage.data;
        setImportedJsonData(externalData);
        setImportMethod('json');
        setStatusMessage('Data received from Chrome extension. Click "Create Components" to proceed.');
        
        // If the JSON contains image data, show a preview
        if (externalData.imageAnalysis && externalData.imageAnalysis.originalImage) {
          setImagePreview(`data:image/jpeg;base64,${externalData.imageAnalysis.originalImage}`);
        }
      }
    };
    
    // Register message listeners
    window.addEventListener('message', handleExternalMessage);
    
    // Also listen for unified system events if core is loaded
    const registerUnifiedListeners = () => {
      if (window.StickerCore) {
        // Register core message listeners
        window.StickerCore.Messenger.on('JSON_DATA_LOADED', (data: any) => {
          console.log('Unified system: JSON data loaded', data);
          if (data && data.jsonData) {
            setImportedJsonData(data.jsonData);
            setImportMethod('json');
            setStatusMessage('JSON data loaded from unified system. Click "Create Components" to proceed.');
          }
        });
        
        window.StickerCore.Messenger.on('IMAGE_SELECTED', (data: any) => {
          console.log('Unified system: Image selected', data);
          if (data && data.file) {
            const file = data.file;
            setImageFile(file);
            setImportMethod('image');
            
            // Create image preview
            const reader = new FileReader();
            reader.onload = (e) => {
              if (e.target) {
                setImagePreview(e.target.result as string);
              }
            };
            reader.readAsDataURL(file);
          }
        });
      }
    };
    
    // Try to register immediately if core is already loaded
    registerUnifiedListeners();
    
    // Also listen for the core loading later
    const coreLoadedCheck = setInterval(() => {
      if (window.StickerCore) {
        registerUnifiedListeners();
        clearInterval(coreLoadedCheck);
      }
    }, 1000);
    
    return () => {
      window.removeEventListener('message', handleExternalMessage);
      clearInterval(coreLoadedCheck);
    };
  }, []);


  // Function to analyze the image or process JSON data
  const analyzeImage = async () => {
    if (importMethod === 'image' && !imageFile) {
      setError('Please select an image first.');
      return;
    }
    
    if (importMethod === 'json' && !importedJsonData) {
      setError('Please import a JSON file first.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let analysisResult;
      
      if (importMethod === 'image') {
        // Process image upload flow
        // Convert image to base64
        const base64Image = await fileToBase64(imageFile!);
        
        // Use the VisionApiService to analyze the image
        analysisResult = await visionService.analyzeImage(base64Image);
      } else {
        // Process JSON import flow - convert the imported data to our internal format
        const jsonData = importedJsonData.imageAnalysis;
        
        // Map the JSON data to our internal ImageAnalysisResult format
        analysisResult = {
          colors: jsonData.colors.map((color: any) => ({
            name: color.name,
            color: { r: color.r, g: color.g, b: color.b },
            opacity: color.opacity || 1
          })),
          typography: jsonData.typography.map((text: any) => ({
            text: text.text,
            fontSize: text.fontSize,
            x: text.x,
            y: text.y,
            width: text.width,
            height: text.height
          })),
          components: jsonData.components.map((component: any) => ({
            id: component.id || `comp-${Math.random().toString(36).substr(2, 9)}`,
            name: component.name,
            type: component.type || 'RECTANGLE',
            x: component.x,
            y: component.y,
            width: component.width,
            height: component.height
          }))
        };
      }
      
      // Optionally enhance with Figma API data
      try {
        // This will search for similar components based on our analysis
        // It's optional and won't block the main flow
        const similarComponents = await figmaService.findSimilarComponents(analysisResult);
        console.log('Found similar components:', similarComponents);
      } catch (figmaError) {
        // Just log Figma API errors, don't stop the process
        console.warn('Figma API error (non-critical):', figmaError);
      }
      
      // Send the processed data back to the plugin main code
      emit('IMAGE_ANALYSIS_COMPLETE', analysisResult);
      
      setStatusMessage('Image analyzed successfully!');
    } catch (err: any) {
      setError(`Error analyzing image: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Convert File to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // Close plugin handler
  const handleClose = useCallback(() => {
    emit('CLOSE_PLUGIN');
  }, []);

  return (
    <div className="plugin-container">
      <div className="tabs">
        <button 
          className={activeTab === 'upload' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('upload')}
        >
          Upload Image
        </button>
        <button 
          className={activeTab === 'settings' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('settings')}
        >
          API Settings
        </button>
        <button 
          className={activeTab === 'help' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('help')}
        >
          Help
        </button>
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="tab-content">
          <div className="import-method-selector">
            <div className="import-options">
              <button 
                className={importMethod === 'image' ? 'option-button active' : 'option-button'}
                onClick={() => setImportMethod('image')}
              >
                Upload Image
              </button>
              <button 
                className={importMethod === 'json' ? 'option-button active' : 'option-button'}
                onClick={() => setImportMethod('json')}
              >
                Import JSON
              </button>
            </div>
          </div>
          
          <div className="upload-container">
            {importMethod === 'image' ? (
              <label className="upload-label">
                {!imagePreview ? (
                  <>
                    <div className="upload-icon">+</div>
                    <span>Click to upload an image</span>
                    <span className="upload-hint">PNG, JPG up to 5MB</span>
                  </>
                ) : (
                  <img src={imagePreview} alt="Preview" className="image-preview" />
                )}
                <input
                  type="file"
                  accept="image/png, image/jpeg"
                  onChange={handleFileChange}
                  className="file-input"
                />
              </label>
            ) : (
              <label className="upload-label">
                {!importedJsonData ? (
                  <>
                    <div className="upload-icon">{'{}'}</div>
                    <span>Click to import JSON data</span>
                    <span className="upload-hint">From Chrome extension export</span>
                  </>
                ) : (
                  <div className="json-preview">
                    <div className="json-icon">✓</div>
                    <div>JSON data imported</div>
                    {imagePreview && <img src={imagePreview} alt="Preview" className="image-preview" />}
                  </div>
                )}
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleFileChange}
                  className="file-input"
                />
              </label>
            )}
          </div>

          <div className="clipboard-options mt-10">
            <button className="button secondary" onClick={handlePasteFromClipboard}>
              Paste from Clipboard
            </button>
                  
            <div className="manual-paste-option mt-10">
              <p className="text-sm">Or paste your JSON data here:</p>
              <textarea 
                rows={4} 
                placeholder="Paste component data JSON here..." 
                className="manual-paste-textarea"
                id="manual-paste-area"
              />
              <button 
                className="button secondary mt-5"
                onClick={() => {
                  const textarea = document.getElementById('manual-paste-area') as HTMLTextAreaElement;
                  if (textarea && textarea.value) {
                    processClipboardText(textarea.value);
                  } else {
                    setError('Please paste data into the textarea first');
                  }
                }}
              >
                Process Pasted Data
              </button>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}
          {statusMessage && <div className="status-message">{statusMessage}</div>}

          <div className="button-row">
            {importMethod === 'json' && !importedJsonData && (
              <button
                className="button accent"
                onClick={() => checkClipboardForComponentData()}
                disabled={isProcessing}
              >
                Paste from Clipboard
              </button>
            )}
            <button
              className="button secondary"
              onClick={handleClose}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              className="button primary"
              onClick={analyzeImage}
              disabled={(importMethod === 'image' && !imageFile || importMethod === 'json' && !importedJsonData) || isProcessing}
            >
              {isProcessing ? 'Processing...' : importMethod === 'image' ? 'Analyze & Create Component' : 'Create from JSON'}
            </button>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="tab-content">
          <div className="settings-container">
            <label className="settings-label">
              Google Cloud Vision API Key
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                className="api-input"
                placeholder="Paste your API key here"
              />
            </label>
            <button
              className="button secondary save-button"
              onClick={handleApiKeySave}
            >
              Save API Key
            </button>
            {statusMessage && <div className="status-message">{statusMessage}</div>}
            <div className="api-instructions">
              <h3>How to get your API key</h3>
              <ol>
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a></li>
                <li>Create a project or select an existing one</li>
                <li>Enable the Cloud Vision API</li>
                <li>Create credentials and copy your API key</li>
                <li>Paste your API key in the field above</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Help Tab */}
      {activeTab === 'help' && (
        <div className="tab-content">
          <div className="help-container">
            <h3>Image Component Analyzer</h3>
            <p>This plugin converts images of UI components into editable Figma components using Google Cloud Vision AI.</p>
            
            <h4>How it works:</h4>
            <ol>
              <li><strong>Upload an image</strong> - The clearer the image, the better the results</li>
              <li><strong>Analysis</strong> - We analyze the image to detect:
                <ul>
                  <li>UI components and layout</li>
                  <li>Text elements and typography</li>
                  <li>Color schemes</li>
                </ul>
              </li>
              <li><strong>Component Creation</strong> - We create a Figma component structure that matches what was detected</li>
            </ol>
            
            <h4>Tips for best results:</h4>
            <ul>
              <li>Use high-quality, clear images</li>
              <li>Simple components work better than complex ones</li>
              <li>Images with good contrast will produce better results</li>
              <li>Text in the image should be clear and readable</li>
            </ul>
            
            <p>Need help? Contact us at support@imagecomponentanalyzer.com</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Plugin;
