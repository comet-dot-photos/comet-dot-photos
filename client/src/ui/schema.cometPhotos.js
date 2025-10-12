// ui/schema.cometPhotos.js

import { SI_NONE, SI_UNMAPPED, SI_PERSPECTIVE, LL_REGRESSION, LL_TERSE, LL_VERBOSE, SD_DAY, SD_MONTH, SD_YEAR} from '../core/constants.js';

export const cometPhotosSchema = [
      {
        folder: 'Getting Started',
        key: 'help',
        items: [
          { type: 'button', key: 'showQuickStart', label: 'Show Quickstart Help', event: 'quickstartHelp' },
          { type: 'multiselect', key: 'datasets', label: 'Choose Datasets:', options: [] }
        ]
      },

      {
        folder: 'Paint Tools',
        key: 'paintTools',
        items: [
          { type: 'row', rowKind: 'buttons', items: [
            { type: 'bool',   key: 'enablePaint',   label: 'Enable Paint:' },
            { type: 'button', key: 'clearPaint',    label: 'Clear Paint',     event: 'clearPaint' }
          ]},
          { type: 'range',  key: 'brushSize',     label: 'Brush Size:',     min: 5,  max: 200, step: 1 },
          { type: 'range',  key: 'percentOverlap',label: 'Percent Overlap:',min: 1,  max: 100, step: 1 },
        ]
      },

      {
        folder: 'Image Filters',
        key: 'filters',
        items: [
          { type: 'range2', key: 'metersPerPixel', label: 'Meters per Pixel:', min: 0,  max: 10,  step: 0.1, decimals: 1 },
          { type: 'range2', key: 'emissionAngle',  label: 'Emission Angle:',   min: 0,  max: 90,  step: 1, decimals: 0 },
          { type: 'range2', key: 'incidenceAngle', label: 'Incidence Angle:',  min: 0,  max: 90,  step: 1, decimals: 0 },
          { type: 'range2', key: 'phaseAngle',     label: 'Phase Angle:',      min: 0,  max: 180, step: 1, decimals: 0 }
        ]
      },

      {
        folder: 'Image Display and Navigation',
        key: 'displayNav',
        items: [
          { type: 'select', key: 'showImage',    label: 'Show Image:', options: [SI_NONE, SI_UNMAPPED, SI_PERSPECTIVE] },
          { type: 'row', items: [
            { type: 'bool', key: 'encircleRegion', label: 'Encircle Region:' },
            { type: 'bool', key: 'showViewport', label: 'Show Viewport:' },
          ]},

          { type: 'row', items: [
            { type: 'bool', key: 'spacecraftView', label: 'Spacecraft View:' },
            { type: 'bool', key: 'showAxes',     label: 'Show Axes:' },
          ]},

          // imageIndex is a single value slider; app can adjust .max(...) after filtering
          { type: 'range',  key: 'imageIndex',   label: 'Image Index:', min: 0, max: Number.MAX_SAFE_INTEGER, step: 1 },
          { type: 'row', rowKind: 'buttons', items: [
            { type: 'button', key: 'previousImage',label: 'Previous Image', event: 'prevImage' },
            { type: 'button', key: 'nextImage',    label: 'Next Image',     event: 'nextImage' },
          ]},

          { type: 'row', rowKind: 'mixed-buttons', items: [
            { type: 'select', key: 'skipDuration', label: 'Skip Duration:', options: [SD_DAY, SD_MONTH, SD_YEAR] },
            { type: 'button', key: 'skipBackward', label: '⇦',  event: 'skipBackward', largeFont: true },
            { type: 'button', key: 'skipForward',  label: '⇨',   event: 'skipForward', largeFont: true },
          ]}
        ]
      },

      {
        folder: 'Image Data',
        key: 'imageData',
        items: [
          { type: 'text',   key: 'matches',   label: 'Matches:' },
          { type: 'text',   key: 'fileName',  label: 'File Name:' },
          { type: 'text',   key: 'time',      label: 'Time:' },
          { type: 'text',   key: 'imageInfo', label: 'Image Info:' },
          { type: 'button', key: 'downloadFileNames', label: 'Download File Names', event: 'downloadFileNames' }
        ]
      },
      {
        folder: 'Debug Options',
        key: 'debugOptions',
        hidden: true,
        items: [
          { type: 'text',   key: 'status',    label: 'Status:' },
          { type: 'select', key: 'logLevel', label: 'Log Level:', options: [LL_REGRESSION, LL_TERSE, LL_VERBOSE] },          
          { type: 'button', key: 'startLog',    label: 'Start Logging', event: 'startLog' },
          { type: 'button', key: 'endLog',      label: 'End Logging',   event: 'endLog' },
          { type: 'button', key: 'runLogFastest',     label:  'Run Log (Fastest)', event: 'runLogFastest' },
          { type: 'button', key: 'runLogFast',     label:  'Run Log (Fast)',       event: 'runLogFast' },
          { type: 'button', key: 'runLogTimed',     label:  'Run Log (Timed)',     event: 'runLogTimed' },
          { type: 'button', key: 'memStats',    label: 'Memory Stats',  event: 'memStats' },
          { type: 'button', key: 'paintVisible',label: 'Paint Visible', event: 'paintVisible' },
          { type: 'button', key: 'preprocess',  label: 'Pre-Process',   event: 'preprocess' },
          { type: 'bool',   key: 'flatShading', label: 'Flat Shading:' },
         ]
      }
    ];

