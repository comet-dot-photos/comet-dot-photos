# Comet.Photos server

As described elsewhere, Comet.Photos has a client-server architecture. The server folder contains code (mostly Javascript and C) that implements the server.

This folder has the source for the Comet.Photos server: 

1. cometserver.js - main server code for Comet.Photos application. Sets up a web sever serving static files, and sets up socket.io event handlers for client-server communication.
2. commonHandlers.js - common socket.io event handlers for both preprocessing and runtime modes.
3. preprocessingHandlers.js - socket.io event handlers for only preprocessing mode.
4. runtimeHandlers - socket.io event handlers for only runtime mode.
5. openInBrowser.js - function to open a given URL in Google Chrome if installed, otherwise falls back to system default browser.
6. load_c.js - loads the platform specific C shared library for visibility checking using the Koffi module.
7. c_build/checkvis2.c - low level C code for visibility checking, version 2. Implemented in C so that bitwise table checks can be most efficiently computed.
8. c_build/popcount.h - fast 64-bit population count helper. Works across architectures/compilers.