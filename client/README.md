# Comet.Photos client 

As described elsewhere, Comet.Photos has a client-server architecture. The client folder contains code (mostly Javascript) that runs in the browser.

## Subdirectory src

This folder has the source for the Comet.Photos client. It is broken up into app, core, filters, ui, utils, and view. 

1. index.html - contains the html file that loads the Javascript, and starts up Comet.Photos.
2. cometPhotos.js - contains the Javascript stub that launches the app. Processes any url arguments, connects to the server via socket.io to fetch the dataset catalog, and initializes the CometPhotosApp object.
3. app/CometPhotosApp.js - implements the CometPhotosApp, and instantiates all of the sub-objects used in the app (GUIController, OverlayCanvas, SceneManager, PaintEvents, FilterEngine, ImageBrowser, Preprocessor, and TestHarness). Very importantly, binds events to event handlers in the HANDLERS object.
4. core/constants.js - defines constants used across multiple source files.
5. core/datasetLoader.js - functions to load comet model and metadata for a given dataset.
6. core/ImageBrowser.js - implements the ImageBrowser class: manages the loading and display of search result sets, and handles navigation over result sets.
7. core/Preprocessor.js - implements the Preprocessor class: handles preprocessing operations such as computing visibility of comet vertices for each image, and communicating with the server during preprocessing mode. This is used only during preprocessing of datasets.
8. core/ROI.js - implements the Region of Interest (ROI) class, extracting it from painted vertices, and packaging it in a bit array that can be sent to the server for visibility checks.
9. core/SceneManager.js - implements the SceneManager class. This object is responsible for the graphics rendering in the main canvas. It uses three.js to set up a scene with a camera, lights, 3D comet model, and a trackball control for exploring the comet model. It also has the render loop that is executed every frame.
10. filters/FilterEngine.js - implements the FilterEngine object, responsible for all filtering operations (spatial and photometric) for Comet.Photos.
11. ui/buildGuiFromSchema.js - builds a control panel interface from a schema description.
12. ui/GuiController.js - implements the GuiController object, which abstracts the control panel, and keeps it separate from the application logic. It communicates with the application logic by triggering events on a bus that are handled by functions bound to these events in CometPhotosApp. This controller uses buildGuiFromSchema to populate the control panel, keeping the details related to the actual widgets used, and events emitted, hidden from  this object.
13. ui/makeDualSlider.js - implements dual-handled sliders (for meters per pixel and the various angle filters).
14. ui/makeMultiSelect.js - implements the multiselect widget for choosing datasets.
15. ui/PaintEvents.js - implements the PaintEvents object, which triggers application level events from mouse and touch events in the canvas containing the 3D Model. These events are consumed by handlers wired up in CometPhotosApp.
16. ui/schema.cometPhotos.js - schema description for building the Comet.Photos control panel. Using a declarative scheme for building the UI keeps things clean.
17. utils/Emitter.js - implements the Emitter object, which is the bus over which events are sent. It supports separation of the UI vs. application logic, and provides some basic logging functionality, which is useful in testing.
18. utils/mergeK.js - merges K sorted arrays, maintaining the sort order. Used to merge multiple dataset metadata.
19. utils/ProjectedImages - routines for projecting images onto a three.js 3D model. Used when "Show Image" is set to "Projected 3D".
20. utils/serialize.js - routines to serialize async function calls.
21. utils/TestHarness.js - implements the TestHarness object, used for regression tests, logging, and playback of scripts.
22. view/CometView.js - implements the CometView object, which represents a single image's viewpoint and projection onto the comet. Also implements the NormalDepth class, which tracks min/max depth along a normal vector for visibility calculations.
23. view/OverlayCanvas.js - implements the OverlayCanvas, which is used to show images in "Unmapped 2D" mode.
24. public/cometIcon.png - a favIcon for Comet.Photos.
25. public/quickstart.html - quickstart documentation for Comet.Photos.
