# Comet.Photos EXTRAS 

This folder contains utilities that fetched the original datasets from the ESA server,
and performed preprocessing to convert the datasets into a form that Comet.Photos could use.

These utilities are not used during runtime, and are included here just for completeness. 
Hence, they are 'extras'.

## Fetching Programs

1. fetch/get_WAC4I.2.sh - retrieved the WAC Level 4 INFDLSTR version 2 images from the ESA server.
2. fetch/get_NAVCAM.v1.sh - retrieved the NAVCAM level 3 version 1 images from the ESA server.
3. fetch/get_ocams_l2.sh - retrieved the OSIRIS-REx Level 2 images for all cameras.

Note: the NAC images were retrieved earlier, back when ESA supported ftp.

## Comet.Photos (v3) Preprocessing

As described in the top-level Comet.Photos README.md, the program can be extended to work with new mission and instrument datasets, without modifying the underlying code. Only the contents of the data folder need to be updated with the new datasets. However, as described in the other README, the datasets do need to be prepared. We include the python programs we wrote to process and shape the data in this extras folder. 

We preprocess a great amount of data to speed up comet.photos during runtime, and produce the data files used by comet.photos. Here we document the steps used to preprocess data for comet.photos v3. Note that regular users do not need to concern themselves with this information - this documents how our dataset (the contents of the data directory) was prepared.

Preprocessing is done separately for each dataset, and takes place in two phases. For each dataset, we start with a folder of Rosetta PDS3 .IMG files. 

Here are some of the more notable programs:

1. organize_pds.py - creates a tree of PDS files that are hard links to the PDS files in the original fetched PDS3 tree, but more clearly organized. The files are placed in subdirectories of the form YYMM, where YY are the last two digits of the year of the image, and MM is the two digit month. This simple organization helps immensely. All processing of the .IMG files then uses this new folder structure.

2. pds_to_jpgs_parallel.py and quick_pds_to_jpgs_parallel.py - creates jpg files by first generating cub files from the img files, and then running USGS tools on the cub files to extract pngs that are converted to jpgs (ImageMagick creates better jpg files from pngs than the USGS tools produce directly). Note: pds_to_jpgs_parallel.py will work on NAC and WAC PDS3 files, because we can create .CUB files as intermediaries and invoke USGS tools. We could not get that working for NAVCAM files (not taken with an OSIRIS imager), so quick_pds_to_jpgs_parallel.py works extracts image data directly from the PDS3s, by invoking shortcut_pds_to_png.py to capture the image data for each. It should work for NAC and WAC too, but for quality and consistency, we prefer to use USGS tools when available.

3. json_from_pds3_rosetta.py - creates the metadata file, imageMetadata_phase1.json, by traversing the PDS files, and extracting from them: the basename ('nm'), time taken ('ti'), image resolution ('rz'). Then we use the SPICE kernel calculations to add the camera vector ('cv'), camera up vector ('up'), spacecraft position ('sc') and Sun position ('su').


## Other files

The **osiris-rex** folder has a programs to extract jpg images from osiris-rex PDS4 files (fits_to_jpgs_parallel.py), create the metadata file from these PDS4 files (json_from_pds4_orex.py), and calculate the field of view of the cameras (ocams_fov.py). The **old** directory contains earlier versions of some of the programs listed above, or programs that are no longer needed. The **test** directory contains some early programs we used to understand the dataset, or develop the ProjectedImages code. The test code for the runtime is included in the client source (primarily TestHarness.js) with support in the server for delivering the regression tests.





