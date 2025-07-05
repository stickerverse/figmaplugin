import { once, showUI } from './utilities';
import UnifiedCore from './unified-core';
import ComponentBuilder from './component-builder';


// Register plugin ID for external communication
const PLUGIN_ID = 'sticker-component-analyzer';

// Add Figma API type declarations
declare global {
  interface SceneNode {
    x: number;
    y: number;
    width: number;
    height: number;
    fills?: ReadonlyArray<Paint>;
    strokes?: ReadonlyArray<Paint>;
    resize?(width: number, height: number): void;
    fillStyleId?: string;
    strokeStyleId?: string;
  }
  
  interface RectangleNode {
    fillStyleId: string;
  }
  
  interface FrameNode {
    resize(width: number, height: number): void;
  }
  
  interface TextNode {
    resize(width: number): void;
  }
  
  interface PageNode {
    selection: ReadonlyArray<SceneNode>;
  }
  
  interface PluginAPI {
    loadFontAsync(fontName: FontName): Promise<void>;
    getStyleByName(name: string): BaseStyle | null;
  }
}

// Define event handlers
interface ImageAnalysisCompleteHandler {
  name: 'IMAGE_ANALYSIS_COMPLETE';
  handler: (imageData: ImageAnalysisResult) => void;
}

interface ClosePluginHandler {
  name: 'CLOSE_PLUGIN';
  handler: () => void;
}

// Define the result type for image analysis
export interface ImageAnalysisResult {
  components: ComponentData[];
  colors: ColorData[];
  typography: TypographyData[];
}

export interface ComponentData {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: any[];
  strokes?: any[];
  children?: string[];
  properties?: Record<string, any>;
}

export interface ColorData {
  name: string;
  color: { r: number; g: number; b: number };
  opacity?: number;
}

export interface TypographyData {
  text: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * This is the main entry point for the Figma plugin
 */
export default async function () {
  // Initialize the unified core system
  await UnifiedCore.initialize();
  
  // Show the plugin UI with the following options
  showUI({
    width: 450,
    height: 550,
    title: 'Image Component Analyzer'
  });

  // Enable communication with the Chrome extension
  setupExternalMessaging();
  
  // Register with the unified system
  figma.ui.postMessage({ type: 'INITIALIZE_UNIFIED_SYSTEM' });

  // Handle image analysis completion
  once<ImageAnalysisCompleteHandler>('IMAGE_ANALYSIS_COMPLETE', async (imageData) => {
    try {
      const parentFrame = await processImageAnalysisResults(imageData);
      figma.currentPage.selection = [parentFrame];
      
      // Notify the UI that creation is complete
      figma.ui.postMessage({ type: 'CREATION_COMPLETE' });
    } catch (error) {
      console.error('Error in image analysis handler:', error);
      figma.ui.postMessage({
        type: 'CREATION_ERROR',
        message: `Error creating components: ${(error as Error).message}`
      });
    } finally {
      // Close the plugin after 2 seconds
      setTimeout(() => figma.closePlugin(), 2000);
    }
  });

  // Handle closing the plugin
  once<ClosePluginHandler>('CLOSE_PLUGIN', () => {
    figma.closePlugin();
  });
}

/**
 * Setup external messaging to allow communication between the Chrome extension and Figma plugin
 */
function setupExternalMessaging() {
  // Register plugin for external messaging
  figma.root.setRelaunchData({ open: '' });
  
  // Setup message listener for incoming data from the unified system
  window.addEventListener('message', (event) => {
    try {
      // Check for messages from our system
      if (event.data && (event.data.source === 'sticker-chrome-extension' || event.data.source === 'sticker-system')) {
        console.log('Received external message:', event.data);
        
        // Extract the component data
        const componentData = event.data.componentData || event.data.data;
        
        if (componentData) {
          // Check if we received simplified data (from our sanitization logic)
          const isSimplified = componentData.simplified === true;
          
          if (isSimplified) {
            console.log('Received simplified component data due to size constraints');
            
            // Notify the UI about the simplified data
            figma.ui.postMessage({
              type: 'EXTERNAL_DATA_RECEIVED',
              data: componentData,
              simplified: true,
              message: componentData.message || 'Data was simplified due to size constraints'
            });
            
            // Also show a notification
            figma.notify('⚠️ Component data was simplified due to size constraints. Some details may be missing.', { timeout: 10000 });
          } else {
            // Process through the unified core if possible for regular data
            if (UnifiedCore) {
              UnifiedCore.processComponentData(componentData)
                .then(processedData => {
                  // Pass the processed data to the UI
                  figma.ui.postMessage({
                    type: 'EXTERNAL_DATA_RECEIVED',
                    data: processedData
                  });
                })
                .catch(err => {
                  console.error('Error processing data through unified core:', err);
                  // Fallback to direct passing
                  figma.ui.postMessage({
                    type: 'EXTERNAL_DATA_RECEIVED',
                    data: componentData
                  });
                });
            } else {
              // Fallback to direct passing if unified core isn't ready
              figma.ui.postMessage({
                type: 'EXTERNAL_DATA_RECEIVED',
                data: componentData
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Error processing external message:', err);
      // Notify about the error
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      figma.notify('❌ Error processing component data: ' + errorMessage, { error: true });
    }
  });
}

/**
 * Process the image analysis results and create Figma elements
 * Uses ComponentBuilder to create true system-ready components with proper styles and Auto Layout
 */
async function processImageAnalysisResults(imageData: ImageAnalysisResult): Promise<FrameNode> {
  // Create parent frame to hold all elements
  const parentFrame = figma.createFrame();
  parentFrame.name = 'Sticker Component Analysis';
  parentFrame.layoutMode = 'VERTICAL'; // Use Auto Layout for the main frame
  parentFrame.counterAxisSizingMode = 'AUTO';
  parentFrame.primaryAxisSizingMode = 'AUTO';
  parentFrame.itemSpacing = 24; // Add nice spacing between sections
  parentFrame.paddingLeft = 32;
  parentFrame.paddingRight = 32;
  parentFrame.paddingTop = 32;
  parentFrame.paddingBottom = 32;
  parentFrame.fills = [{type: 'SOLID', color: {r: 0.98, g: 0.98, b: 0.98}}];
  
  // Track if we have detected component variants
  let hasVariants = false;
  let variantComponents: ComponentData[] = [];
  
  // 1. Create a style guide section with colors
  if (imageData.colors && imageData.colors.length > 0) {
    // Create a color palette section with Auto Layout
    const colorSection = figma.createFrame();
    colorSection.name = 'Color Palette';
    colorSection.layoutMode = 'VERTICAL';
    colorSection.counterAxisSizingMode = 'AUTO';
    colorSection.primaryAxisSizingMode = 'AUTO';
    colorSection.itemSpacing = 16;
    colorSection.fills = [];
    
    // Add a title
    const title = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = "Color Styles";
    title.fontSize = 16;
    colorSection.appendChild(title);
    
    // Create a row for colors with horizontal Auto Layout
    const colorRow = figma.createFrame();
    colorRow.name = 'Colors';
    colorRow.layoutMode = 'HORIZONTAL';
    colorRow.counterAxisSizingMode = 'AUTO';
    colorRow.primaryAxisSizingMode = 'AUTO';
    colorRow.itemSpacing = 12;
    colorRow.fills = [];
    
    // Add each color as a small rectangle with style
    const swatchSize = 48;
    
    for (let i = 0; i < imageData.colors.length; i++) {
      const colorData = imageData.colors[i];
      const colorWrapper = figma.createFrame();
      colorWrapper.name = `Color-${colorData.name}-Wrapper`;
      colorWrapper.layoutMode = 'VERTICAL';
      colorWrapper.counterAxisSizingMode = 'AUTO';
      colorWrapper.primaryAxisSizingMode = 'AUTO';
      colorWrapper.itemSpacing = 4;
      colorWrapper.fills = [];
      
      // Create the color swatch
      const rect = figma.createRectangle();
      rect.name = colorData.name;
      rect.resize(swatchSize, swatchSize);
      
      // Create the solid paint
      const paint: SolidPaint = {
        type: 'SOLID',
        color: colorData.color,
        opacity: colorData.opacity || 1
      };
      
      // See if we already have this color as a style
      const styleName = `Color/${colorData.name}`;
      let style = figma.getStyleByName(styleName) as PaintStyle;
      
      // Create the style if it doesn't exist
      if (!style) {
        style = figma.createPaintStyle();
        style.name = styleName;
        style.paints = [paint];
      }
      
      // Apply the paint and link to style
      rect.fills = [paint];
      rect.cornerRadius = 4; // Rounded corners look nicer
      rect.fillStyleId = style.id;
      
      // Create text label with the color name
      const label = figma.createText();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      label.characters = colorData.name;
      label.fontSize = 11;
      label.textAlignHorizontal = 'CENTER';
      
      // Add to wrapper frame
      colorWrapper.appendChild(rect);
      colorWrapper.appendChild(label);
      
      // Add to color row
      colorRow.appendChild(colorWrapper);
    }
    
    // Add the color row to the section
    colorSection.appendChild(colorRow);
    
    // Add the color section to the parent frame
    parentFrame.appendChild(colorSection);
  }
  
  // 2. Create typography section with text styles
  if (imageData.typography && imageData.typography.length > 0) {
    // Create typography section with Auto Layout
    const typoSection = figma.createFrame();
    typoSection.name = 'Typography';
    typoSection.layoutMode = 'VERTICAL';
    typoSection.counterAxisSizingMode = 'AUTO';
    typoSection.primaryAxisSizingMode = 'AUTO';
    typoSection.itemSpacing = 16;
    typoSection.fills = [];
    
    // Add a title
    const title = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = "Text Styles";
    title.fontSize = 16;
    typoSection.appendChild(title);
    
    // Group similar text elements to detect patterns
    const textGroups: Record<string, TypographyData[]> = {};
    
    for (const text of imageData.typography) {
      // Group by font size and family if available
      const key = `${text.fontSize || 'unknown'}-${text.fontName?.family || 'unknown'}`;
      if (!textGroups[key]) {
        textGroups[key] = [];
      }
      textGroups[key].push(text);
    }
    
    // Create text style for each distinct group
    for (const key in textGroups) {
      if (textGroups[key].length > 0) {
        const sample = textGroups[key][0];
        const fontSize = sample.fontSize || 16;
        const fontName = sample.fontName || { family: "Inter", style: "Regular" };
        
        // Create text style
        const styleName = `Text/${fontName.family}-${fontName.style}/${fontSize}px`;
        let style = figma.getStyleByName(styleName) as TextStyle;
        
        // Create the style if it doesn't exist
        if (!style) {
          style = figma.createTextStyle();
          style.name = styleName;
          await figma.loadFontAsync(fontName);
          style.fontName = fontName;
          style.fontSize = fontSize;
        }
        
        // Create a sample text element with this style
        const text = figma.createText();
        await figma.loadFontAsync(fontName);
        text.fontName = fontName;
        text.fontSize = fontSize;
        text.characters = sample.text || `${fontName.family} ${fontSize}px`;
        text.textStyleId = style.id;
        
        // Add to typography section
        typoSection.appendChild(text);
      }
    }
    
    // Add typography section to the main frame
    parentFrame.appendChild(typoSection);
  }
  
  // 3. Create system-ready UI components
  if (imageData.components && imageData.components.length > 0) {
    // Create components section with Auto Layout
    const componentsSection = figma.createFrame();
    componentsSection.name = 'Components';
    componentsSection.layoutMode = 'VERTICAL';
    componentsSection.counterAxisSizingMode = 'AUTO';
    componentsSection.primaryAxisSizingMode = 'AUTO';
    componentsSection.itemSpacing = 24;
    componentsSection.fills = [];
    
    // Add a title
    const title = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = "UI Components";
    title.fontSize = 16;
    componentsSection.appendChild(title);
    
    // Check if we have multiple component variants
    if (imageData.components.length > 1 && 
        imageData.components[0].name === imageData.components[1].name) {
      // If we have identically named components, treat them as variants
      hasVariants = true;
      variantComponents = imageData.components;
      
      try {
        // Create a component set with variants
        const componentSet = await ComponentBuilder.createComponentSet(variantComponents);
        componentsSection.appendChild(componentSet as SceneNode);
      } catch (error) {
        console.error('Error creating component variants:', error);
        hasVariants = false; // Fall back to individual components
      }
    }
    
    // If we don't have variants or variant creation failed, create individual components
    if (!hasVariants) {
      for (let i = 0; i < imageData.components.length; i++) {
        try {
          // Create a system-ready component with Auto Layout detection
          const component = await ComponentBuilder.createSystemComponent(imageData.components[i]);
          componentsSection.appendChild(component);
        } catch (error) {
          console.error('Error creating component:', error);
          
          // Fallback to basic component creation if builder fails
          const compData = imageData.components[i];
          const fallbackComponent = figma.createComponent();
          fallbackComponent.resize(compData.width, compData.height);
          fallbackComponent.name = compData.name || `Component ${i+1}`;
          
          // Apply fills if available
          if (compData.fills) {
            fallbackComponent.fills = compData.fills as Paint[];
          }
          
          componentsSection.appendChild(fallbackComponent);
        }
      }
    }
    
    // Add components section to the main frame
    parentFrame.appendChild(componentsSection);
  }
  
  // Add the parent frame to the current page
  figma.currentPage.appendChild(parentFrame);
  
  // Select the frame for better user visibility
  figma.currentPage.selection = [parentFrame];
  figma.viewport.scrollAndZoomIntoView([parentFrame]);
  
  return parentFrame;
}
