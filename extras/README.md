# Comet.Photos EXTRAS 

This folder contains utilities that fetched the original datasets from the ESA server,
and performed preprocessing to convert the datasets into a form that Comet.Photos could use.

These utilities are not used during runtime, and are included here just for completeness. 
Hence, they are 'extras'.

## Fetching Programs

1. fetch/get_WAC4I.2.sh - retrieved the WAC Level 4 INFDLSTR version 2 images from the ESA server.
2. fetch/get_NAVCAM.v1.sh - retrieved the NAVCAM level 3 version 1 images from the ESA server.

Note: the NAC images were retrieved earlier, back when ESA supported ftp.

## Comet.Photos (v3) Preprocessing

We preprocess a great amount of data to speed up comet.photos during runtime, and produce the data files used by comet.photos. Here we document the steps used to preprocess data for comet.photos v3. Note that regular users do not need to concern themselves with this information - this documents how our dataset (the contents of the data directory) was prepared.

Preprocessing is done separately for each dataset, and takes place in two phases. For each datset, we start with a folder of Rosetta PDS3 .IMG files. 

### Preprocessing Phase 1

1. organize_imgs.py - creates a tree of .IMG files that are hard links to the .IMG files in the original fetched PDS3 tree, but more clearly organized. The files are placed in subdirectories of the form YYMM, where YY are the last two digits of the year of the image, and MM is the two digit month. This simple organization helps immensely. All processing of the .IMG files then uses this new folder structure.

2. pds_to_jpgs.py and quick_pds_to_jpgs.py - creates jpg files by first generating cub files from the img files, and then running USGS tools on the cub files to extract pngs that are converted to jpgs (ImageMagick creates better jpg files from pngs than the USGS tools produce directly). Note: pds_to_jpgs.py will work on NAC and WAC PDS3 files, because we can create .CUB files as intermediaries and invoke USGS tools. We could not get that working for NAVCAM files (not taken with an OSIRIS imager), so quick_pds_to_jpgs.py works extracts image data directly from the PDS3s, by invoking shortcut_pds_to_png.py to capture the image data for each. It should work for NAC and WAC too, but for quality and consistency, we prefer to use USGS tools when available.

3. json_from_imgs_directly4.py - creates the phase 1 version of the metadata file, imageMetadata_phase1.json, by traversing the .IMG files, and extracting from them: the basename ('nm'), time taken ('ti'), image resolution ('rz'). Then we use the SPICE kernel calculations to add the camera vector ('cv'), camera up vector ('up'), spacecraft position ('sc') and Sun position ('su').


### Preprocessing Phase 2

Additional visibility/spatial information is generated in phase 2 of preprocessing. This is done by using the imageMetadata_phase1.json file generated in Phase 1 as the input metadata file to the Comet.Photos server (cometserver.js), while the environmental variable "PREPROCESSING" is set to be true. The cometserver will open up a window, do visibility processing on all of the images, and create a new, complete imageMetadata_phase2.json file and visTableV2.0.bin.new in the server directory. Those two files are then renamed (imageMetaDataNAC.json and visTableNAC.bin) and moved to the data folder for comet.photos searches. 

Since some jpg files will not be included (they may not contain the comet or the pixel scale might be too low-resolution), copy_only_used_jpgs.py creates a jpg tree with only the jpgs represented in the imageMetaData, removing extraneous images from the dataset.

Preprocessing is now complete.

## Other files

The **old** directory contains earlier versions of some of the programs listed above, or programs that are no longer needed. The **test** directory contains some early programs we used to understand the dataset, or develop the ProjectedImages code. The test code for the runtime is included in the client source (primarily TestHarness.js) with some support in the server for delivering the regression tests.





